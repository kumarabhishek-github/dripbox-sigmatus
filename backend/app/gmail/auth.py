from __future__ import annotations

import imaplib
import smtplib
from typing import Optional

from sqlalchemy.orm import Session

from ..settings_store import resolve_email_creds


def connection_ok(db: Optional[Session] = None) -> tuple[bool, bool, str | None]:
    """Probe SMTP + IMAP login. Returns (smtp_ok, imap_ok, error_msg).

    Credentials are read fresh from the DB (with env fallback) on each call so
    edits in the UI take effect immediately.
    """
    creds = resolve_email_creds(db)
    errors: list[str] = []

    smtp_ok = False
    if not creds["smtp_username"] or not creds["smtp_password"]:
        errors.append("SMTP credentials not configured")
    else:
        try:
            smtp = smtplib.SMTP(creds["smtp_host"], creds["smtp_port"], timeout=15)
            try:
                smtp.ehlo()
                if creds["smtp_use_tls"]:
                    smtp.starttls()
                    smtp.ehlo()
                smtp.login(creds["smtp_username"], creds["smtp_password"])
                smtp_ok = True
            finally:
                try:
                    smtp.quit()
                except Exception:
                    try:
                        smtp.close()
                    except Exception:
                        pass
        except Exception as e:
            errors.append(f"SMTP: {e}")

    imap_ok = False
    if not creds["imap_username"] or not creds["imap_password"]:
        errors.append("IMAP credentials not configured")
    else:
        try:
            imap = imaplib.IMAP4_SSL(creds["imap_host"], creds["imap_port"])
            try:
                imap.login(creds["imap_username"], creds["imap_password"])
                imap_ok = True
            finally:
                try:
                    imap.logout()
                except Exception:
                    pass
        except Exception as e:
            errors.append(f"IMAP: {e}")

    err = "; ".join(errors) if errors else None
    return smtp_ok, imap_ok, err
