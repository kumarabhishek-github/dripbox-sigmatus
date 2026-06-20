from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Setting
from ..settings_store import (
    PASSWORD_KEYS,
    MASK,
    mask_password,
    db_password_is_set,
)


router = APIRouter(prefix="/api/settings", tags=["settings"])


def _load_all(db: Session) -> dict[str, Any]:
    rows = db.scalars(select(Setting)).all()
    return {r.key: r.value for r in rows}


def _serialize(db: Session) -> dict[str, Any]:
    raw = _load_all(db)
    out: dict[str, Any] = {}
    for k, v in raw.items():
        if k in PASSWORD_KEYS:
            out[k] = mask_password(v)
        else:
            out[k] = v
    # Always include the password-set helper flags so the frontend can render
    # the "(saved)" hint even when the password is sourced from env.
    out["smtp_password_set"] = db_password_is_set(db, "smtp_password")
    out["imap_password_set"] = db_password_is_set(db, "imap_password")
    return out


@router.get("")
def list_settings(db: Session = Depends(get_db)):
    return _serialize(db)


@router.put("")
def update_settings(payload: dict[str, Any], db: Session = Depends(get_db)):
    for key, value in payload.items():
        # Never let derived/read-only fields be written.
        if key in ("smtp_password_set", "imap_password_set"):
            continue

        if key in PASSWORD_KEYS:
            # Skip-on-mask: empty string or the mask sentinel means "leave alone".
            if value is None or value == "" or value == MASK:
                continue
            _upsert(db, key, value)
        else:
            # Non-password: empty string clears the DB row (env fallback applies).
            if value is None or value == "":
                row = db.get(Setting, key)
                if row is not None:
                    db.delete(row)
            else:
                _upsert(db, key, value)

    db.commit()
    return _serialize(db)


def _upsert(db: Session, key: str, value: Any) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value
