from __future__ import annotations

from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import (
    Contact, ContactStage, RecipientStage,
    Event, EventType, Enrollment, EnrollmentStatus,
    ScheduledSend, SendStatus,
)


def _skip_pending_sends(db: Session, enrollment_id: int, reason: str) -> None:
    """Mark any still-pending ScheduledSend rows for this enrollment as skipped,
    so a stopped enrollment doesn't keep a misleading 'next send' in the UI."""
    db.execute(
        update(ScheduledSend)
        .where(
            ScheduledSend.enrollment_id == enrollment_id,
            ScheduledSend.status == SendStatus.pending,
        )
        .values(status=SendStatus.skipped, error=f"enrollment stopped: {reason}")
    )


# Contact-stage rank (used for manual overrides + global stage decisions).
STAGE_RANK: dict[ContactStage, int] = {
    ContactStage.new: 0,
    ContactStage.contacted: 1,
    ContactStage.opened: 2,
    ContactStage.replied: 3,
    ContactStage.interested: 4,
    ContactStage.lost: 5,
    ContactStage.registered: 6,
}

TERMINAL = {ContactStage.registered, ContactStage.lost}


def _log_stage_change(
    db: Session,
    contact: Contact,
    frm,
    to,
    enrollment: Optional[Enrollment] = None,
) -> None:
    data: dict = {"from": getattr(frm, "value", str(frm)), "to": getattr(to, "value", str(to))}
    if enrollment is not None:
        data["enrollment_id"] = enrollment.id
        data["campaign_id"] = enrollment.campaign_id
    db.add(Event(contact_id=contact.id, type=EventType.stage_change, data=data))


def stop_active_enrollments(db: Session, contact: Contact, reason: str) -> None:
    for enr in db.scalars(
        select(Enrollment).where(
            Enrollment.contact_id == contact.id,
            Enrollment.status == EnrollmentStatus.active,
        )
    ).all():
        enr.status = EnrollmentStatus.stopped
        enr.stopped_reason = reason
        _skip_pending_sends(db, enr.id, reason)


def set_enrollment_stage(
    db: Session,
    enrollment: Enrollment,
    new_stage: RecipientStage,
    reason: Optional[str] = None,
) -> None:
    if enrollment.stage == new_stage:
        return
    old = enrollment.stage
    enrollment.stage = new_stage
    _log_stage_change(db, enrollment.contact, old, new_stage, enrollment=enrollment)
    if new_stage == RecipientStage.replied:
        # Replied is terminal for the enrollment.
        enrollment.status = EnrollmentStatus.stopped
        enrollment.stopped_reason = reason or "replied"
        _skip_pending_sends(db, enrollment.id, enrollment.stopped_reason)


def set_stage(
    db: Session,
    contact: Contact,
    new_stage: ContactStage,
    reason: Optional[str] = None,
) -> None:
    """Manual override on the global Contact.stage."""
    if contact.stage == new_stage:
        return
    old = contact.stage
    contact.stage = new_stage
    _log_stage_change(db, contact, old, new_stage)
    if new_stage in TERMINAL:
        stop_active_enrollments(db, contact, reason or new_stage.value)


def _advance_contact_on_event(
    db: Session, contact: Contact, event_type: EventType
) -> None:
    """Push the Contact's CRM stage forward based on an engagement event.
    Manual stages (interested/registered/lost) are not auto-overwritten."""
    cur = contact.stage
    if cur in TERMINAL or cur == ContactStage.interested:
        return
    if event_type == EventType.sent and cur == ContactStage.new:
        set_stage(db, contact, ContactStage.contacted, reason="sent")
    elif event_type == EventType.opened and cur in {ContactStage.new, ContactStage.contacted}:
        set_stage(db, contact, ContactStage.opened, reason="opened")
    elif event_type == EventType.replied and cur != ContactStage.replied:
        set_stage(db, contact, ContactStage.replied, reason="replied")


def auto_advance_on_event(
    db: Session,
    contact: Contact,
    event_type: EventType,
    enrollment: Optional[Enrollment] = None,
) -> None:
    """Advance per-enrollment recipient stage AND roll the contact stage forward."""
    if enrollment is not None:
        cur = enrollment.stage
        if event_type == EventType.sent and cur == RecipientStage.pending:
            set_enrollment_stage(db, enrollment, RecipientStage.sent, reason="sent")
        elif event_type == EventType.opened and cur in {RecipientStage.pending, RecipientStage.sent}:
            set_enrollment_stage(db, enrollment, RecipientStage.opened, reason="opened")
        elif event_type == EventType.replied and cur != RecipientStage.replied:
            set_enrollment_stage(db, enrollment, RecipientStage.replied, reason="replied")

    _advance_contact_on_event(db, contact, event_type)
