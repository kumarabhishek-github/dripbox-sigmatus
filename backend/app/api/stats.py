from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Contact, ContactStage, Event, EventType, ScheduledSend, SendStatus,
)


router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    per_stage: dict[str, int] = {}
    for s in ContactStage:
        per_stage[s.value] = db.scalar(
            select(func.count(Contact.id)).where(Contact.stage == s)
        ) or 0

    start_today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sends_today = db.scalar(
        select(func.count(ScheduledSend.id)).where(
            ScheduledSend.status == SendStatus.sent,
            ScheduledSend.sent_at >= start_today,
        )
    ) or 0

    seven_days_ago = datetime.utcnow() - timedelta(days=7)

    def _ev(t: EventType) -> int:
        return db.scalar(
            select(func.count(Event.id)).where(Event.type == t, Event.created_at >= seven_days_ago)
        ) or 0

    upcoming = db.scalar(
        select(func.count(ScheduledSend.id)).where(ScheduledSend.status == SendStatus.pending)
    ) or 0

    return {
        "stage_counts": per_stage,
        "sends_today": sends_today,
        "opens_7d": _ev(EventType.opened),
        "clicks_7d": _ev(EventType.clicked),
        "replies_7d": _ev(EventType.replied),
        "upcoming_queue_count": upcoming,
    }
