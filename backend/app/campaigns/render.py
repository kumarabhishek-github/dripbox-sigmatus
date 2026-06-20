from __future__ import annotations

import re
import secrets
from pathlib import Path
from typing import Tuple

from bs4 import BeautifulSoup
from jinja2 import Environment, FileSystemLoader, BaseLoader, select_autoescape
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Template, Contact, ScheduledSend, TrackingToken, TokenKind


TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"

_URL_RE = re.compile(r"https?://[^\s<>\"')]+")


def _file_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )


def _string_env(autoescape: bool) -> Environment:
    return Environment(
        loader=BaseLoader(),
        autoescape=select_autoescape(["html", "xml"]) if autoescape else False,
    )


def _context(contact: Contact) -> dict:
    ctx = {
        "name": contact.name or "",
        "email": contact.email,
        "unsubscribe_keyword": settings.UNSUBSCRIBE_KEYWORD,
    }
    ctx.update(contact.custom_fields or {})
    return ctx


def _template_format(template: Template) -> str:
    return (template.format or "html").lower()


def _render_subject(template: Template, ctx: dict) -> str:
    env = _string_env(autoescape=False)
    return env.from_string(template.subject_template).render(**ctx)


def _render_body(template: Template, ctx: dict) -> str:
    fmt = _template_format(template)
    if template.body:
        env = _string_env(autoescape=(fmt == "html"))
        return env.from_string(template.body).render(**ctx)
    # Fall back to on-disk file (seeded HTML templates).
    if not template.file_path:
        raise ValueError("template has no body and no file_path")
    env = _file_env()
    return env.get_template(template.file_path).render(**ctx)


def render_preview(template: Template, contact: Contact) -> Tuple[str, str]:
    ctx = _context(contact)
    return _render_subject(template, ctx), _render_body(template, ctx)


def render_subject(template: Template, contact: Contact) -> str:
    """Render just the subject line for a contact (no body, no tracking tokens).

    Used to reuse the thread root's subject on threaded follow-up sends."""
    return _render_subject(template, _context(contact))


def _new_token() -> str:
    # 9 bytes → 12 url-safe chars, ~72 bits of entropy. Plenty for click/open
    # tokens (scoped to a single send, no auth value).
    return secrets.token_urlsafe(9)


def _instrument_html(db: Session, html: str, send: ScheduledSend, base: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for a in soup.find_all("a"):
        href = a.get("href")
        if not href or href.startswith("mailto:") or href.startswith("#"):
            continue
        token = _new_token()
        db.add(TrackingToken(send_id=send.id, kind=TokenKind.click, url=href, token=token))
        a["href"] = f"{base}/t/c/{token}"

    open_token = _new_token()
    db.add(TrackingToken(send_id=send.id, kind=TokenKind.open, url=None, token=open_token))
    pixel_url = f"{base}/t/o/{open_token}.gif"
    pixel_tag = soup.new_tag("img", src=pixel_url, width="1", height="1", style="display:none")
    body = soup.find("body")
    if body:
        body.append(pixel_tag)
    else:
        soup.append(pixel_tag)
    return str(soup)


def _instrument_plaintext(db: Session, body: str, send: ScheduledSend, base: str) -> str:
    """Plaintext: rewrite inline URLs through the click tracker. No open tracking
    (would require a visible footer link, which we deliberately omit)."""
    def _replace(match: re.Match[str]) -> str:
        url = match.group(0)
        token = _new_token()
        db.add(TrackingToken(send_id=send.id, kind=TokenKind.click, url=url, token=token))
        return f"{base}/t/c/{token}"

    return _URL_RE.sub(_replace, body)


def render_email(
    db: Session, template: Template, contact: Contact, send: ScheduledSend
) -> Tuple[str, str, str]:
    """Returns (subject, body, format). Caller must read format to pick MIME type."""
    ctx = _context(contact)
    subject = _render_subject(template, ctx)
    body = _render_body(template, ctx)
    base = settings.BASE_URL.rstrip("/")
    fmt = _template_format(template)
    if fmt == "plaintext":
        return subject, _instrument_plaintext(db, body, send, base), "plaintext"
    return subject, _instrument_html(db, body, send, base), "html"
