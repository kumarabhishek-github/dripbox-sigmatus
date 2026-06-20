from __future__ import annotations

import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Campaign, CampaignStatus, Contact, Enrollment, EnrollmentStatus,
    ScheduledSend, SendStatus, CampaignStep,
)
from ..settings_store import resolve_scheduling
from .window import next_in_window


def _jittered_send_at(base: datetime, db) -> datetime:
    sched = resolve_scheduling(db)
    n = sched["at_jitter_minutes"]
    if n > 0:
        base = base + timedelta(minutes=random.randint(-n, n))
    # Never let jitter (or a small day_offset) place the send in the past:
    # next_in_window returns its input unchanged when it falls inside the
    # window, so without this floor a negative jitter would yield a past
    # send_at that the tick picks up immediately.
    now = datetime.utcnow()
    if base < now:
        base = now
    # Roll forward to next in-window slot if outside business hours.
    return next_in_window(base, db=db)


def enroll_contacts(db: Session, campaign: Campaign, contact_ids: list[int]) -> dict:
    steps = sorted(campaign.steps, key=lambda s: s.order)
    if not steps:
        return {"enrolled": 0, "skipped": 0, "reason": "no steps"}
    first_step = steps[0]

    enrolled = 0
    skipped = 0
    now = datetime.utcnow()

    for cid in contact_ids:
        contact = db.get(Contact, cid)
        if not contact:
            skipped += 1
            continue
        if contact.unsubscribed:
            skipped += 1
            continue
        existing = db.scalar(
            select(Enrollment).where(
                Enrollment.contact_id == cid,
                Enrollment.campaign_id == campaign.id,
            )
        )
        if existing:
            skipped += 1
            continue

        enrollment = Enrollment(
            contact_id=cid,
            campaign_id=campaign.id,
            status=EnrollmentStatus.active,
        )
        db.add(enrollment)
        db.flush()

        # Only schedule the first send if the campaign is active. For drafts
        # (and paused campaigns), the first send is materialized when the
        # campaign is activated via schedule_first_step_for_unscheduled.
        if campaign.status == CampaignStatus.active:
            send_at = _jittered_send_at(now + timedelta(days=first_step.day_offset), db)
            db.add(ScheduledSend(
                enrollment_id=enrollment.id,
                step_id=first_step.id,
                send_at=send_at,
                status=SendStatus.pending,
            ))
        enrolled += 1

    db.commit()
    return {"enrolled": enrolled, "skipped": skipped}


def schedule_first_step_for_unscheduled(db: Session, campaign: Campaign) -> int:
    """Schedule the first step for active enrollments that have no sends yet.

    Called when a campaign transitions into the active state so enrollments
    accumulated during draft get materialized into the upcoming sends queue.
    Returns the number of enrollments that received a new ScheduledSend.
    """
    steps = sorted(campaign.steps, key=lambda s: s.order)
    if not steps:
        return 0
    first_step = steps[0]
    now = datetime.utcnow()

    enrollments = db.scalars(
        select(Enrollment).where(
            Enrollment.campaign_id == campaign.id,
            Enrollment.status == EnrollmentStatus.active,
        )
    ).all()

    scheduled = 0
    for e in enrollments:
        existing = db.scalar(
            select(ScheduledSend.id).where(ScheduledSend.enrollment_id == e.id)
        )
        if existing:
            continue
        send_at = _jittered_send_at(now + timedelta(days=first_step.day_offset), db)
        db.add(ScheduledSend(
            enrollment_id=e.id,
            step_id=first_step.id,
            send_at=send_at,
            status=SendStatus.pending,
        ))
        scheduled += 1
    if scheduled:
        db.commit()
    return scheduled


def enqueue_next_step(db: Session, enrollment: Enrollment, current_step: CampaignStep) -> bool:
    next_step = db.scalar(
        select(CampaignStep).where(
            CampaignStep.campaign_id == current_step.campaign_id,
            CampaignStep.order > current_step.order,
        ).order_by(CampaignStep.order.asc()).limit(1)
    )
    if not next_step:
        enrollment.status = EnrollmentStatus.completed
        return False
    send_at = _jittered_send_at(datetime.utcnow() + timedelta(days=next_step.day_offset), db)
    db.add(ScheduledSend(
        enrollment_id=enrollment.id,
        step_id=next_step.id,
        send_at=send_at,
        status=SendStatus.pending,
    ))
    return True
