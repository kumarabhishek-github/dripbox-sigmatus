"""Lightweight runtime SQLite migrations.

We're not on Alembic. This module inspects the live DB at startup and applies
ALTER TABLE add-column statements for any columns missing on existing prod
databases. Idempotent; safe to call on every boot.
"""
from __future__ import annotations

import logging
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


# (table, column, "<col-def>") — col-def must be a valid SQLite type/default
_ADDITIVE: list[tuple[str, str, str]] = [
    ("templates", "body", "TEXT"),
    ("templates", "format", "VARCHAR(16) NOT NULL DEFAULT 'html'"),
    ("enrollments", "stage", "VARCHAR(32) NOT NULL DEFAULT 'pending'"),
    ("campaigns", "thread_emails", "BOOLEAN NOT NULL DEFAULT 0"),
    ("scheduled_sends", "sent_subject", "TEXT"),
    ("contacts", "first_name", "VARCHAR(255)"),
    ("contacts", "last_name", "VARCHAR(255)"),
    ("contacts", "business_name", "VARCHAR(255)"),
]


def apply_migrations(engine: Engine) -> None:
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, column, coldef in _ADDITIVE:
            if not insp.has_table(table):
                continue
            cols = {c["name"] for c in insp.get_columns(table)}
            if column in cols:
                continue
            logger.info("migrations: ALTER %s ADD %s %s", table, column, coldef)
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coldef}"))

        # One-shot: collapse legacy ContactStage values stored on enrollments.stage
        # into the new RecipientStage enum (pending/sent/opened/replied).
        if insp.has_table("enrollments"):
            stage_map = {
                "new": "pending",
                "contacted": "sent",
                "interested": "replied",
                "registered": "replied",
                "lost": "sent",
            }
            for old, new in stage_map.items():
                conn.execute(
                    text("UPDATE enrollments SET stage = :new WHERE stage = :old"),
                    {"new": new, "old": old},
                )

        # Backfill first_name and last_name from name for existing contacts
        if insp.has_table("contacts"):
            conn.execute(
                text(
                    """
                    UPDATE contacts 
                    SET first_name = CASE 
                        WHEN instr(trim(name), ' ') > 0 THEN substr(trim(name), 1, instr(trim(name), ' ') - 1)
                        ELSE trim(name)
                    END,
                    last_name = CASE 
                        WHEN instr(trim(name), ' ') > 0 THEN substr(trim(name), instr(trim(name), ' ') + 1)
                        ELSE NULL
                    END
                    WHERE first_name IS NULL AND name IS NOT NULL AND trim(name) != ''
                    """
                )
            )

        # file_path was NOT NULL in original schema. SQLite can't drop NOT NULL
        # cleanly, so we just stop enforcing it at the ORM layer; existing rows
        # are unaffected, new in-DB-body templates pass an empty string.
