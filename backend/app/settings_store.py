from __future__ import annotations

import os
from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import Setting


# Credential keys editable via the settings API. All read DB first, then fall
# back to the env var of the same name (uppercased).
CREDENTIAL_KEYS: tuple[str, ...] = (
    "smtp_host",
    "smtp_port",
    "smtp_username",
    "smtp_password",
    "smtp_use_tls",
    "imap_host",
    "imap_port",
    "imap_username",
    "imap_password",
    "sender_email",
    "sender_name",
)

PASSWORD_KEYS: frozenset[str] = frozenset({"smtp_password", "imap_password"})

# Scheduling keys editable from the Settings page. All read DB first, then fall
# back to env via the upper-cased name.
SCHEDULING_KEYS: tuple[str, ...] = (
    "send_window_enabled",
    "send_timezone",
    "send_hour_start",
    "send_hour_end",
    "send_weekdays_only",
    "send_at_jitter_minutes",
)

MASK = "********"


def get_setting(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(Setting, key)
    if row is None:
        return default
    return row.value


def set_setting(db: Session, key: str, value: Any) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value


def _stringify(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def get_credential(db: Optional[Session], key: str) -> str:
    """Return DB value if set non-empty, else env var (uppercased), else ''.

    Always returns a string. Callers that need int/bool should coerce.
    """
    if db is not None:
        try:
            v = get_setting(db, key)
        except Exception:
            v = None
        s = _stringify(v).strip()
        if s != "":
            return s
    env = os.environ.get(key.upper(), "")
    return env or ""


def get_credential_int(db: Optional[Session], key: str, default: int) -> int:
    raw = get_credential(db, key)
    if not raw:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def get_credential_bool(db: Optional[Session], key: str, default: bool) -> bool:
    raw = get_credential(db, key).lower()
    if raw == "":
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


def mask_password(value: Any) -> str:
    """Return mask if a non-empty password is set, else empty string."""
    if value is None:
        return ""
    s = str(value)
    if s == "":
        return ""
    return MASK


def password_is_set(db: Session, key: str) -> bool:
    """True if a non-empty password exists in DB OR env."""
    return get_credential(db, key) != ""


def db_password_is_set(db: Session, key: str) -> bool:
    """True only if a non-empty password is stored in the DB (env doesn't count)."""
    try:
        v = get_setting(db, key)
    except Exception:
        return False
    return _stringify(v).strip() != ""


def resolve_scheduling(db: Optional[Session] = None) -> dict:
    """Effective send-window/jitter settings (DB → env → config default).

    If `db` is None, opens its own short-lived session so callers without one
    (e.g. window helpers) can still hit DB-backed overrides.
    """
    from .config import settings as cfg

    own = db is None
    if own:
        from .db import SessionLocal
        db = SessionLocal()
    try:
        return {
            "enabled": get_credential_bool(db, "send_window_enabled", cfg.SEND_WINDOW_ENABLED),
            "timezone": get_credential(db, "send_timezone") or cfg.SEND_TIMEZONE,
            "hour_start": get_credential_int(db, "send_hour_start", cfg.SEND_HOUR_START),
            "hour_end": get_credential_int(db, "send_hour_end", cfg.SEND_HOUR_END),
            "weekdays_only": get_credential_bool(db, "send_weekdays_only", cfg.SEND_WEEKDAYS_ONLY),
            "at_jitter_minutes": get_credential_int(db, "send_at_jitter_minutes", cfg.SEND_AT_JITTER_MINUTES),
        }
    finally:
        if own:
            db.close()


def resolve_daily_send_cap(db: Optional[Session] = None) -> int:
    """Effective daily send cap (DB → env → config default).

    Mirrors resolve_scheduling so the Settings-page `daily_send_cap` value
    actually takes effect: DB row wins, then the DAILY_SEND_CAP env var, then
    the config default. Opens its own short-lived session when `db` is None.
    """
    from .config import settings as cfg

    own = db is None
    if own:
        from .db import SessionLocal
        db = SessionLocal()
    try:
        return get_credential_int(db, "daily_send_cap", cfg.DAILY_SEND_CAP)
    finally:
        if own:
            db.close()


def resolve_email_creds(db: Optional[Session]) -> dict:
    """Resolve effective SMTP/IMAP settings combining DB + env fallback.

    Returns a dict with all keys. Strings are empty when not set. Numeric/bool
    fields are coerced. `imap_username`/`imap_password`/`sender_email` fall back
    to SMTP values when blank, matching the legacy config.py @property logic.
    """
    from .config import settings as cfg

    smtp_host = get_credential(db, "smtp_host") or cfg.SMTP_HOST
    smtp_port = get_credential_int(db, "smtp_port", cfg.SMTP_PORT)
    smtp_username = get_credential(db, "smtp_username") or cfg.SMTP_USERNAME
    smtp_password = get_credential(db, "smtp_password") or cfg.SMTP_PASSWORD
    smtp_use_tls = get_credential_bool(db, "smtp_use_tls", cfg.SMTP_USE_TLS)

    imap_host = get_credential(db, "imap_host") or cfg.IMAP_HOST
    imap_port = get_credential_int(db, "imap_port", cfg.IMAP_PORT)
    imap_username = get_credential(db, "imap_username") or (cfg.IMAP_USERNAME or "") or smtp_username
    imap_password = get_credential(db, "imap_password") or (cfg.IMAP_PASSWORD or "") or smtp_password

    sender_email = get_credential(db, "sender_email") or (cfg.SENDER_EMAIL or "") or smtp_username
    sender_name = get_credential(db, "sender_name") or cfg.SENDER_NAME

    return {
        "smtp_host": smtp_host,
        "smtp_port": smtp_port,
        "smtp_username": smtp_username,
        "smtp_password": smtp_password,
        "smtp_use_tls": smtp_use_tls,
        "imap_host": imap_host,
        "imap_port": imap_port,
        "imap_username": imap_username,
        "imap_password": imap_password,
        "sender_email": sender_email,
        "sender_name": sender_name,
    }
