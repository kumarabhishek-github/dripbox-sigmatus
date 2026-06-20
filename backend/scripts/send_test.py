"""Smoke test: send one email using current DB-or-env credentials.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/send_test.py recipient@example.com
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import SessionLocal
from app.gmail.auth import connection_ok
from app.gmail.send import send_email


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/send_test.py <recipient-email>")
        return 1

    to = sys.argv[1]

    db = SessionLocal()
    try:
        smtp_ok, imap_ok, err = connection_ok(db)
        print(f"SMTP login: {'OK' if smtp_ok else 'FAIL'}")
        print(f"IMAP login: {'OK' if imap_ok else 'FAIL'}")
        if err:
            print(f"Error: {err}")
        if not smtp_ok:
            return 2

        subject = "Campaign Monitor — smoke test"
        html = """
        <html><body>
        <h2>Smoke test</h2>
        <p>If you can read this, SMTP send is working end-to-end.</p>
        <p>Reply with the word <b>unsubscribe</b> to test reply detection + opt-out.</p>
        </body></html>
        """
        msg_id, thread_id = send_email(to, subject, html)
        print(f"Sent. Message-ID: {msg_id}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
