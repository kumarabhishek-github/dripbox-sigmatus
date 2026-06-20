from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..db import get_db
from ..gmail.auth import connection_ok
from ..gmail.send import send_email
from ..settings_store import resolve_email_creds


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _status_payload(db: Session) -> dict:
    smtp_ok, imap_ok, error = connection_ok(db)
    creds = resolve_email_creds(db)
    return {
        "smtp_ok": smtp_ok,
        "imap_ok": imap_ok,
        "error": error,
        "sender_email": creds["sender_email"],
    }


@router.get("/email/status")
def email_status(db: Session = Depends(get_db)):
    return _status_payload(db)


@router.post("/email/test")
def email_test(db: Session = Depends(get_db)):
    """Force an immediate connection test using current (DB or env) creds."""
    return _status_payload(db)


class SendTestRequest(BaseModel):
    to: EmailStr


@router.post("/email/send-test")
def email_send_test(body: SendTestRequest, db: Session = Depends(get_db)):
    """Send a single smoke-test email to the given recipient using current creds."""
    creds = resolve_email_creds(db)
    subject = "Campaign Monitor — test email"
    html = (
        "<html><body>"
        "<h2>Test email</h2>"
        "<p>If you can read this, sending is working end-to-end.</p>"
        f"<p>Sent from <b>{creds['sender_email']}</b>.</p>"
        "</body></html>"
    )
    try:
        msg_id, _ = send_email(body.to, subject, html)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"sent": True, "to": body.to, "message_id": msg_id}
