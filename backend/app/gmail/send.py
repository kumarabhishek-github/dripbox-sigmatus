from __future__ import annotations

import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, make_msgid

from ..db import SessionLocal
from ..settings_store import resolve_email_creds


def _html_to_text(html: str) -> str:
    text = re.sub(r"<\s*br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</\s*p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def send_email(
    to_email: str,
    subject: str,
    body: str,
    format: str = "html",
    in_reply_to: str | None = None,
    references: str | None = None,
) -> tuple[str, str]:
    """Send an email via SMTP.

    `format` is "html" or "plaintext"; HTML sends are multipart/alternative with a
    stripped plain-text fallback, plaintext sends are bare text/plain.

    When `in_reply_to` is given (the Message-ID of an earlier message), the standard
    threading headers are set so mail clients group this message into that thread.
    `references` should be the full space-joined chain of prior Message-IDs; it
    falls back to `in_reply_to` if omitted.
    """
    db = SessionLocal()
    try:
        creds = resolve_email_creds(db)
    finally:
        db.close()

    sender_email = creds["sender_email"]
    if not sender_email:
        raise RuntimeError("SENDER_EMAIL/SMTP_USERNAME is not configured")

    domain = sender_email.split("@", 1)[1] if "@" in sender_email else "localhost"
    msg_id = make_msgid(domain=domain)

    fmt = (format or "html").lower()
    if fmt == "plaintext":
        msg = MIMEText(body, "plain", "utf-8")
    else:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(_html_to_text(body), "plain", "utf-8"))
        msg.attach(MIMEText(body, "html", "utf-8"))

    msg["To"] = to_email
    msg["From"] = formataddr((creds["sender_name"], sender_email))
    msg["Subject"] = subject
    msg["Message-ID"] = msg_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = references or in_reply_to

    smtp = smtplib.SMTP(creds["smtp_host"], creds["smtp_port"], timeout=30)
    try:
        smtp.ehlo()
        if creds["smtp_use_tls"]:
            smtp.starttls()
            smtp.ehlo()
        smtp.login(creds["smtp_username"], creds["smtp_password"])
        smtp.sendmail(sender_email, [to_email], msg.as_string())
    finally:
        try:
            smtp.quit()
        except Exception:
            try:
                smtp.close()
            except Exception:
                pass

    return msg_id, msg_id
