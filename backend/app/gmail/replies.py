from __future__ import annotations

import email
import imaplib
import re
from datetime import datetime, timedelta
from email.message import Message
from email.utils import getaddresses
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..settings_store import resolve_email_creds
from ..models import (
    ScheduledSend, Event, EventType, Contact, ContactStage,
    Enrollment, EnrollmentStatus,
)
from ..crm.stages import auto_advance_on_event, _skip_pending_sends


_MSGID_RE = re.compile(r"<[^<>\s]+>")
# Common "On <date>, <person> wrote:" delimiters in reply quotes. We only need
# to catch the start of the quoted block; anything after gets dropped.
_QUOTE_HEADER_RE = re.compile(
    r"(?im)^\s*(on\s.+?\bwrote:|from:\s.+|-----\s*original message\s*-----).*$"
)

# Automated bounce / non-delivery reports (NDRs) thread on the original message
# via In-Reply-To/References, so they otherwise look like replies. Detect them so
# we can tag them as bounces and unsubscribe the dead address instead.
_BOUNCE_FROM_RE = re.compile(r"mailer-daemon|postmaster|mail delivery", re.IGNORECASE)
_BOUNCE_SUBJECT_RE = re.compile(
    r"delivery status notification|undeliverable|mail delivery (failed|subsystem)|"
    r"returned mail|delivery (has )?failed|failure notice|message blocked|"
    r"couldn'?t be delivered",
    re.IGNORECASE,
)
_BOUNCE_BODY_RE = re.compile(
    r"address not found|could(n'?t| not) be delivered|was(n'?t| not) delivered|"
    r"recipient('?s)? (inbox|mailbox) (is )?full|mailbox (is )?full|"
    r"user unknown|no such user|account does not exist|recipient address rejected|"
    r"delivery (to the following|has failed)|permanent (failure|error)|"
    r"quota exceeded|account (has been )?disabled|message blocked",
    re.IGNORECASE,
)


def _strip_quoted_reply(text: str) -> str:
    """Return only the new content the recipient typed, dropping the quoted original.

    Heuristics: cut at the first 'On ... wrote:' line, then drop any line starting with '>'.
    """
    if not text:
        return ""
    m = _QUOTE_HEADER_RE.search(text)
    if m:
        text = text[: m.start()]
    new_lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith(">")]
    return "\n".join(new_lines).strip()


def _extract_msgids(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return _MSGID_RE.findall(value)


def _strip_html(html: str) -> str:
    text = re.sub(r"<\s*br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</\s*p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text


def _decode_payload(part: Message) -> str:
    try:
        payload = part.get_payload(decode=True)
        if payload is None:
            return ""
        charset = part.get_content_charset() or "utf-8"
        return payload.decode(charset, errors="ignore")
    except Exception:
        return ""


def _extract_body(msg: Message) -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disp:
                continue
            if ctype == "text/plain":
                plain_parts.append(_decode_payload(part))
            elif ctype == "text/html":
                html_parts.append(_decode_payload(part))
    else:
        ctype = msg.get_content_type()
        body = _decode_payload(msg)
        if ctype == "text/html":
            html_parts.append(body)
        else:
            plain_parts.append(body)

    if plain_parts:
        return "\n".join(p for p in plain_parts if p)
    if html_parts:
        return _strip_html("\n".join(p for p in html_parts if p))
    return ""


def _from_email(msg: Message) -> str:
    addrs = getaddresses(msg.get_all("From", []) or [])
    if not addrs:
        return ""
    return (addrs[0][1] or "").lower()


def _is_bounce_message(msg: Message, from_addr: str, subject: str, body: str) -> bool:
    """Heuristically detect a non-delivery report (bounce) vs a genuine reply."""
    raw_from = " ".join(msg.get_all("From", []) or [])
    if _BOUNCE_FROM_RE.search(raw_from) or _BOUNCE_FROM_RE.search(from_addr or ""):
        return True
    # Standard DSN MIME structure (RFC 3464): multipart/report with a
    # message/delivery-status part.
    if (msg.get_content_type() or "").lower() == "multipart/report":
        if "delivery-status" in (msg.get_param("report-type") or "").lower():
            return True
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "message/delivery-status":
                return True
    if subject and _BOUNCE_SUBJECT_RE.search(subject):
        return True
    if body and _BOUNCE_BODY_RE.search(body):
        return True
    return False


def _unsubscribe_contact(db: Session, contact: Contact, send: ScheduledSend, source: str) -> None:
    """Mark a contact unsubscribed and stop all their active enrollments."""
    if contact.unsubscribed:
        return
    contact.unsubscribed = True
    db.add(Event(
        contact_id=contact.id,
        send_id=send.id,
        type=EventType.unsubscribed,
        data={"source": source},
    ))
    for enr in db.scalars(
        select(Enrollment).where(
            Enrollment.contact_id == contact.id,
            Enrollment.status == EnrollmentStatus.active,
        )
    ).all():
        enr.status = EnrollmentStatus.stopped
        enr.stopped_reason = "unsubscribed"
        _skip_pending_sends(db, enr.id, "unsubscribed")


def poll_replies(db: Session) -> int:
    creds = resolve_email_creds(db)
    imap_username = creds["imap_username"]
    imap_password = creds["imap_password"]
    if not imap_username or not imap_password:
        return 0

    try:
        imap = imaplib.IMAP4_SSL(creds["imap_host"], creds["imap_port"])
    except Exception:
        return 0

    count = 0
    try:
        try:
            imap.login(imap_username, imap_password)
        except Exception:
            return 0

        try:
            imap.select("INBOX", readonly=True)
        except Exception:
            return 0

        since = (datetime.utcnow() - timedelta(days=7)).strftime("%d-%b-%Y")
        try:
            typ, data = imap.search(None, f'(SINCE {since})')
        except Exception:
            return 0
        if typ != "OK" or not data or not data[0]:
            return 0

        uids = data[0].split()
        my_email = (imap_username or "").lower()
        sender_email = (creds["sender_email"] or "").lower()

        for uid in uids:
            try:
                typ, msg_data = imap.fetch(uid, "(RFC822)")
            except Exception:
                continue
            if typ != "OK" or not msg_data:
                continue

            raw = None
            for chunk in msg_data:
                if isinstance(chunk, tuple) and len(chunk) >= 2:
                    raw = chunk[1]
                    break
            if not raw:
                continue

            try:
                msg = email.message_from_bytes(raw)
            except Exception:
                continue

            inbound_msgid = (msg.get("Message-ID") or "").strip()
            from_addr = _from_email(msg)
            if from_addr and (from_addr == my_email or from_addr == sender_email):
                continue

            in_reply_to = msg.get("In-Reply-To")
            references = msg.get("References")
            referenced_ids = set(_extract_msgids(in_reply_to)) | set(_extract_msgids(references))
            if not referenced_ids:
                continue

            sends = db.scalars(
                select(ScheduledSend).where(
                    ScheduledSend.gmail_message_id.in_(referenced_ids)
                )
            ).all()
            if not sends:
                # Also try thread_id match (we stored msg-id there too)
                sends = db.scalars(
                    select(ScheduledSend).where(
                        ScheduledSend.gmail_thread_id.in_(referenced_ids)
                    )
                ).all()
            if not sends:
                continue

            send = sends[0]
            enrollment = send.enrollment
            contact = enrollment.contact

            body_text = _extract_body(msg)
            subject = (msg.get("Subject") or "").strip()
            is_bounce = _is_bounce_message(msg, from_addr, subject, body_text)
            event_type = EventType.bounced if is_bounce else EventType.replied

            # Skip if we've already recorded this exact inbound message — under
            # either type, so a message stored as a reply before this rollout (or
            # before the reclassify backfill ran) isn't re-recorded as a bounce.
            already = False
            for ev in db.scalars(
                select(Event).where(
                    Event.contact_id == contact.id,
                    Event.type.in_([EventType.replied, EventType.bounced]),
                )
            ).all():
                if (ev.data or {}).get("gmail_message_id") == inbound_msgid:
                    already = True
                    break
            if already:
                continue

            if is_bounce:
                # A non-delivery report: tag as a bounce and unsubscribe the dead
                # address rather than treating it as a reply.
                db.add(Event(
                    contact_id=contact.id,
                    send_id=send.id,
                    type=EventType.bounced,
                    data={
                        "gmail_message_id": inbound_msgid,
                        "in_reply_to": in_reply_to,
                        "from": from_addr,
                        "subject": subject[:200],
                    },
                ))
                _unsubscribe_contact(db, contact, send, source="bounce")
                count += 1
                continue

            new_text = _strip_quoted_reply(body_text or "")
            snippet = (new_text or body_text or "").strip().replace("\n", " ")[:200]

            db.add(Event(
                contact_id=contact.id,
                send_id=send.id,
                type=EventType.replied,
                data={
                    "gmail_message_id": inbound_msgid,
                    "in_reply_to": in_reply_to,
                    "from": from_addr,
                    "snippet": snippet,
                },
            ))

            auto_advance_on_event(db, contact, EventType.replied, enrollment=enrollment)

            # Only flag as unsubscribe when the keyword is the entire content of a
            # line in the *new* reply text (after quote stripping). Substring matches
            # in the quoted original (e.g. our own footer) don't count.
            keyword = settings.UNSUBSCRIBE_KEYWORD.lower().strip()
            unsub_match = any(
                ln.strip().lower() == keyword
                for ln in (new_text or "").splitlines()
            )
            if unsub_match:
                _unsubscribe_contact(db, contact, send, source="reply_keyword")

            count += 1

        db.commit()
        return count
    finally:
        try:
            imap.logout()
        except Exception:
            try:
                imap.shutdown()
            except Exception:
                pass
