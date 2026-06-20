from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Template


DEFAULT_TEMPLATES = [
    {
        "name": "Intro",
        "file_path": "intro.html",
        "subject_template": "Quick question, {{ name }}",
    },
    {
        "name": "Follow-up",
        "file_path": "followup.html",
        "subject_template": "Re: quick question",
    },
    {
        "name": "Breakup",
        "file_path": "breakup.html",
        "subject_template": "Closing the loop",
    },
]


def seed_templates(db: Session) -> int:
    """Insert default example templates if not already present. Returns count added."""
    added = 0
    for spec in DEFAULT_TEMPLATES:
        existing = db.scalar(select(Template).where(Template.name == spec["name"]))
        if existing:
            continue
        db.add(Template(**spec))
        added += 1
    if added:
        db.commit()
    return added
