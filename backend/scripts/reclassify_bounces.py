"""Re-classify existing 'replied' events that are actually bounces (NDRs).

Bounce / non-delivery reports thread on the original message, so before bounce
detection existed they were recorded as replies. This finds those events (by the
sender being a mail daemon, or the snippet matching a failure phrase), retags
them as 'bounced', and unsubscribes the dead address.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/reclassify_bounces.py            # dry run, prints what it would do
    python scripts/reclassify_bounces.py --apply     # actually write changes
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import SessionLocal
from app.models import Event, EventType
from app.gmail.replies import (
    _BOUNCE_FROM_RE,
    _BOUNCE_BODY_RE,
    _unsubscribe_contact,
)
from sqlalchemy import select


def _looks_like_bounce(data: dict) -> bool:
    from_addr = str((data or {}).get("from") or "")
    snippet = str((data or {}).get("snippet") or "")
    if _BOUNCE_FROM_RE.search(from_addr):
        return True
    if snippet and _BOUNCE_BODY_RE.search(snippet):
        return True
    return False


def main() -> int:
    apply = "--apply" in sys.argv[1:]

    db = SessionLocal()
    try:
        replied = db.scalars(
            select(Event).where(Event.type == EventType.replied)
        ).all()

        hits = [ev for ev in replied if _looks_like_bounce(ev.data or {})]

        print(f"Scanned {len(replied)} 'replied' events; {len(hits)} look like bounces.\n")
        for ev in hits:
            contact = ev.contact
            data = ev.data or {}
            print(
                f"  event #{ev.id}  contact={contact.email if contact else '?'}  "
                f"from={data.get('from')!r}  snippet={str(data.get('snippet'))[:60]!r}"
            )

        if not hits:
            print("Nothing to do.")
            return 0

        if not apply:
            print(f"\nDry run. Re-run with --apply to retag {len(hits)} events and "
                  f"unsubscribe those contacts.")
            return 0

        unsubbed = 0
        for ev in hits:
            ev.type = EventType.bounced
            new_data = dict(ev.data or {})
            new_data["reclassified_from"] = "replied"
            # Surface the snippet as a subject-ish label for the UI.
            if "subject" not in new_data and new_data.get("snippet"):
                new_data["subject"] = str(new_data["snippet"])[:200]
            ev.data = new_data
            contact = ev.contact
            send = ev.send
            if contact and send and not contact.unsubscribed:
                _unsubscribe_contact(db, contact, send, source="bounce")
                unsubbed += 1

        db.commit()
        print(f"\nRetagged {len(hits)} events as 'bounced'; unsubscribed {unsubbed} contacts.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
