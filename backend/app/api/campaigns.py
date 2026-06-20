from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, distinct, case
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Campaign, CampaignStep, CampaignStatus, Enrollment, EnrollmentStatus,
    ScheduledSend, SendStatus, Event, EventType, Contact, ContactStage,
    RecipientStage, Template, TrackingToken,
)
from sqlalchemy import delete as sa_delete
from pydantic import BaseModel

from ..schemas import (
    CampaignCreate, CampaignUpdate, CampaignOut, CampaignStepIn,
    EnrollRequest,
)
from ..campaigns.enroll import enroll_contacts, schedule_first_step_for_unscheduled
from ..campaigns.scheduler import send_one_now, blast_pending_sends


class StepsPayload(BaseModel):
    steps: list[CampaignStepIn]


class DuplicatePayload(BaseModel):
    name: Optional[str] = None
    copy_recipients: bool = False


router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


@router.post("", response_model=CampaignOut)
def create_campaign(payload: CampaignCreate, db: Session = Depends(get_db)):
    c = Campaign(name=payload.name, status=payload.status, thread_emails=payload.thread_emails)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.get("", response_model=list[CampaignOut])
def list_campaigns(db: Session = Depends(get_db)):
    return db.scalars(select(Campaign).order_by(Campaign.created_at.desc())).all()


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(campaign_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    return c


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(campaign_id: int, payload: CampaignUpdate, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    if payload.name is not None:
        c.name = payload.name
    activating = (
        payload.status is not None
        and payload.status == CampaignStatus.active
        and c.status != CampaignStatus.active
    )
    if payload.status is not None:
        c.status = payload.status
    if payload.thread_emails is not None:
        c.thread_emails = payload.thread_emails
    db.commit()
    if activating:
        schedule_first_step_for_unscheduled(db, c)
    db.refresh(c)
    return c


@router.delete("/{campaign_id}")
def delete_campaign(campaign_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/{campaign_id}/duplicate", response_model=CampaignOut)
def duplicate_campaign(
    campaign_id: int,
    payload: DuplicatePayload,
    db: Session = Depends(get_db),
):
    src = db.get(Campaign, campaign_id)
    if not src:
        raise HTTPException(404, "not found")
    new_name = (payload.name or f"{src.name} (copy)").strip()
    if not new_name:
        raise HTTPException(400, "name cannot be empty")
    dup = Campaign(name=new_name, status=CampaignStatus.draft, thread_emails=src.thread_emails)
    db.add(dup)
    db.flush()
    for s in src.steps:
        db.add(CampaignStep(
            campaign_id=dup.id,
            order=s.order,
            template_id=s.template_id,
            day_offset=s.day_offset,
        ))
    db.flush()
    if payload.copy_recipients:
        contact_ids = list(db.scalars(
            select(distinct(Enrollment.contact_id)).where(
                Enrollment.campaign_id == src.id
            )
        ).all())
        if contact_ids:
            enroll_contacts(db, dup, contact_ids)
    db.commit()
    db.refresh(dup)
    return dup


@router.put("/{campaign_id}/steps", response_model=CampaignOut)
def replace_steps(campaign_id: int, payload: StepsPayload, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    steps = payload.steps
    for s in steps:
        if not db.get(Template, s.template_id):
            raise HTTPException(400, f"template {s.template_id} not found")
    for existing in list(c.steps):
        db.delete(existing)
    db.flush()
    for s in steps:
        db.add(CampaignStep(
            campaign_id=c.id,
            order=s.order,
            template_id=s.template_id,
            day_offset=s.day_offset,
        ))
    db.commit()
    db.refresh(c)
    return c


@router.post("/{campaign_id}/enroll")
def enroll(campaign_id: int, payload: EnrollRequest, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    ids: list[int] = []
    if payload.contact_ids:
        ids = list(payload.contact_ids)
    else:
        filt = payload.filter or {}
        q = select(Contact.id).where(Contact.unsubscribed == False)  # noqa: E712
        stage = filt.get("stage")
        if stage:
            try:
                stage_enum = ContactStage(stage)
            except ValueError:
                raise HTTPException(400, "invalid stage filter")
            q = q.where(Contact.stage == stage_enum)
        source = filt.get("source")
        if source:
            q = q.where(Contact.source == source)
        # Exclude contacts already enrolled in this campaign.
        already = select(Enrollment.contact_id).where(
            Enrollment.campaign_id == campaign_id
        )
        q = q.where(Contact.id.not_in(already))
        ids = list(db.scalars(q).all())
    if not ids:
        raise HTTPException(400, "no matching contacts to enroll")
    result = enroll_contacts(db, c, ids)
    return result


@router.delete("/{campaign_id}/enrollments/{enrollment_id}")
def remove_enrollment(
    campaign_id: int,
    enrollment_id: int,
    db: Session = Depends(get_db),
):
    """Hard-delete an enrollment along with its sends, tracking tokens, and
    related send-scoped events. Engagement history for those sends is lost."""
    enr = db.get(Enrollment, enrollment_id)
    if not enr or enr.campaign_id != campaign_id:
        raise HTTPException(404, "enrollment not found")

    send_ids = list(db.scalars(
        select(ScheduledSend.id).where(ScheduledSend.enrollment_id == enr.id)
    ).all())
    if send_ids:
        db.execute(sa_delete(TrackingToken).where(TrackingToken.send_id.in_(send_ids)))
        db.execute(sa_delete(Event).where(Event.send_id.in_(send_ids)))
    # Enrollment cascades to ScheduledSend via relationship config.
    db.delete(enr)
    db.commit()
    return {"ok": True, "deleted_sends": len(send_ids)}


@router.post("/{campaign_id}/sends/{send_id}/send-now")
def send_now(campaign_id: int, send_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "campaign not found")
    s = db.get(ScheduledSend, send_id)
    if not s or s.enrollment.campaign_id != campaign_id:
        raise HTTPException(404, "send not found in this campaign")
    try:
        s = send_one_now(db, send_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"send failed: {e}")
    return {
        "send_id": s.id,
        "status": s.status.value,
        "sent_at": s.sent_at.isoformat() if s.sent_at else None,
        "error": s.error,
    }


@router.post("/{campaign_id}/sends/send-all")
def send_all_now(campaign_id: int, db: Session = Depends(get_db)):
    """Fire every pending send for this campaign right now, spaced by jitter.

    Returns immediately with the queue size; sends happen in a background
    thread that uses the configured SEND_JITTER_MIN/MAX between consecutive
    sends. Business-hours window and per-tick caps are bypassed.
    """
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "campaign not found")
    rows = db.scalars(
        select(ScheduledSend)
        .join(Enrollment, ScheduledSend.enrollment_id == Enrollment.id)
        .where(
            Enrollment.campaign_id == campaign_id,
            ScheduledSend.status == SendStatus.pending,
        )
        .order_by(ScheduledSend.send_at.asc())
    ).all()
    send_ids = [s.id for s in rows]
    if not send_ids:
        return {"queued": 0}
    blast_pending_sends(send_ids)
    return {"queued": len(send_ids)}


@router.get("/{campaign_id}/upcoming")
def upcoming(campaign_id: int, limit: int = 20, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    q = (
        select(ScheduledSend, Enrollment, Contact, CampaignStep, Template)
        .join(Enrollment, ScheduledSend.enrollment_id == Enrollment.id)
        .join(Contact, Enrollment.contact_id == Contact.id)
        .join(CampaignStep, ScheduledSend.step_id == CampaignStep.id)
        .join(Template, CampaignStep.template_id == Template.id)
        .where(
            Enrollment.campaign_id == campaign_id,
            ScheduledSend.status == SendStatus.pending,
        )
        .order_by(ScheduledSend.send_at.asc())
        .limit(limit)
    )
    rows = db.execute(q).all()
    return [
        {
            "send_id": s.id,
            "send_at": s.send_at.isoformat() + "Z" if s.send_at.tzinfo is None else s.send_at.isoformat(),
            "step_order": step.order,
            "template_name": tpl.name,
            "contact_id": contact.id,
            "contact_email": contact.email,
            "contact_name": contact.name,
        }
        for (s, _enr, contact, step, tpl) in rows
    ]


@router.get("/{campaign_id}/recipients")
def list_recipients(
    campaign_id: int,
    stage: Optional[RecipientStage] = None,
    clicked: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")

    q = (
        select(Enrollment, Contact)
        .join(Contact, Enrollment.contact_id == Contact.id)
        .where(Enrollment.campaign_id == campaign_id)
    )
    if stage is not None:
        q = q.where(Enrollment.stage == stage)
    rows = db.execute(q.order_by(Enrollment.enrolled_at.desc())).all()

    result = []
    for enr, contact in rows:
        sends = db.scalars(
            select(ScheduledSend).where(ScheduledSend.enrollment_id == enr.id)
        ).all()
        sent_count = sum(1 for s in sends if s.status == SendStatus.sent)
        pending = [s for s in sends if s.status == SendStatus.pending]
        next_send_at = min((s.send_at for s in pending), default=None)

        send_ids = [s.id for s in sends]
        opens_unique = 0
        replies_unique = 0
        clicks_count = 0
        if send_ids:
            opens_unique = db.scalar(
                select(func.count(distinct(Event.send_id)))
                .where(Event.send_id.in_(send_ids), Event.type == EventType.opened)
            ) or 0
            replies_unique = db.scalar(
                select(func.count(distinct(Event.send_id)))
                .where(Event.send_id.in_(send_ids), Event.type == EventType.replied)
            ) or 0
            clicks_count = db.scalar(
                select(func.count(Event.id))
                .where(Event.send_id.in_(send_ids), Event.type == EventType.clicked)
            ) or 0

        if clicked is True and clicks_count == 0:
            continue
        if clicked is False and clicks_count > 0:
            continue

        result.append({
            "enrollment_id": enr.id,
            "contact_id": contact.id,
            "contact_email": contact.email,
            "contact_name": contact.name,
            "stage": enr.stage.value,
            "status": enr.status.value,
            "enrolled_at": enr.enrolled_at.isoformat(),
            "sent_count": sent_count,
            "opens_unique": opens_unique,
            "replies_unique": replies_unique,
            "clicks_count": clicks_count,
            "next_send_at": next_send_at.isoformat() if next_send_at else None,
            "unsubscribed": contact.unsubscribed,
        })
    return result


@router.get("/{campaign_id}/recipients/{enrollment_id}/timeline")
def recipient_timeline(campaign_id: int, enrollment_id: int, db: Session = Depends(get_db)):
    enr = db.get(Enrollment, enrollment_id)
    if not enr or enr.campaign_id != campaign_id:
        raise HTTPException(404, "enrollment not found in this campaign")
    contact = enr.contact

    sends = db.scalars(
        select(ScheduledSend)
        .where(ScheduledSend.enrollment_id == enrollment_id)
        .order_by(ScheduledSend.send_at.asc())
    ).all()

    send_payloads = []
    for s in sends:
        step = s.step
        template = step.template if step else None
        events = db.scalars(
            select(Event)
            .where(Event.send_id == s.id)
            .order_by(Event.created_at.asc())
        ).all()
        send_payloads.append({
            "send_id": s.id,
            "step_order": step.order if step else None,
            "template_name": template.name if template else None,
            "status": s.status.value,
            "send_at": s.send_at.isoformat(),
            "sent_at": s.sent_at.isoformat() if s.sent_at else None,
            "error": s.error,
            "events": [
                {
                    "id": e.id,
                    "type": e.type.value,
                    "created_at": e.created_at.isoformat(),
                    "data": e.data or {},
                }
                for e in events
            ],
        })

    # Also surface stage_change events not tied to a send (manual stage edits etc.)
    stage_events = db.scalars(
        select(Event)
        .where(
            Event.contact_id == contact.id,
            Event.type == EventType.stage_change,
            Event.send_id.is_(None),
        )
        .order_by(Event.created_at.asc())
    ).all()

    return {
        "enrollment": {
            "id": enr.id,
            "campaign_id": enr.campaign_id,
            "contact_id": contact.id,
            "contact_email": contact.email,
            "contact_name": contact.name,
            "stage": enr.stage.value,
            "status": enr.status.value,
            "enrolled_at": enr.enrolled_at.isoformat(),
            "stopped_reason": enr.stopped_reason,
        },
        "sends": send_payloads,
        "stage_events": [
            {
                "id": e.id,
                "created_at": e.created_at.isoformat(),
                "data": e.data or {},
            }
            for e in stage_events
        ],
    }


@router.post("/{campaign_id}/pause", response_model=CampaignOut)
def pause(campaign_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    c.status = CampaignStatus.paused
    db.commit()
    db.refresh(c)
    return c


@router.post("/{campaign_id}/resume", response_model=CampaignOut)
def resume(campaign_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")
    was_active = c.status == CampaignStatus.active
    c.status = CampaignStatus.active
    db.commit()
    if not was_active:
        schedule_first_step_for_unscheduled(db, c)
    db.refresh(c)
    return c


@router.get("/{campaign_id}/stats")
def stats(campaign_id: int, db: Session = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "not found")

    enrolled = db.scalar(
        select(func.count(Enrollment.id)).where(Enrollment.campaign_id == campaign_id)
    ) or 0

    sent_q = (
        select(func.count(ScheduledSend.id))
        .join(Enrollment, ScheduledSend.enrollment_id == Enrollment.id)
        .where(Enrollment.campaign_id == campaign_id, ScheduledSend.status == SendStatus.sent)
    )
    sent = db.scalar(sent_q) or 0

    recipients = db.scalar(
        select(func.count(distinct(Enrollment.contact_id)))
        .join(ScheduledSend, ScheduledSend.enrollment_id == Enrollment.id)
        .where(Enrollment.campaign_id == campaign_id, ScheduledSend.status == SendStatus.sent)
    ) or 0

    def _ev_count(event_type: EventType) -> tuple[int, int]:
        total = db.scalar(
            select(func.count(Event.id))
            .join(ScheduledSend, Event.send_id == ScheduledSend.id)
            .join(Enrollment, ScheduledSend.enrollment_id == Enrollment.id)
            .where(Enrollment.campaign_id == campaign_id, Event.type == event_type)
        ) or 0
        unique = db.scalar(
            select(func.count(distinct(Event.contact_id)))
            .join(ScheduledSend, Event.send_id == ScheduledSend.id)
            .join(Enrollment, ScheduledSend.enrollment_id == Enrollment.id)
            .where(Enrollment.campaign_id == campaign_id, Event.type == event_type)
        ) or 0
        return total, unique

    opens, unique_opens = _ev_count(EventType.opened)
    clicks, unique_clicks = _ev_count(EventType.clicked)
    replies, unique_replies = _ev_count(EventType.replied)

    registered = db.scalar(
        select(func.count(Enrollment.id))
        .join(Contact, Enrollment.contact_id == Contact.id)
        .where(Enrollment.campaign_id == campaign_id, Contact.stage == ContactStage.registered)
    ) or 0
    unsubscribed = db.scalar(
        select(func.count(distinct(Contact.id)))
        .join(Enrollment, Enrollment.contact_id == Contact.id)
        .where(Enrollment.campaign_id == campaign_id, Contact.unsubscribed == True)
    ) or 0

    def _rate(num: int, denom: int) -> float:
        return round((num / denom), 4) if denom else 0.0

    rates = {
        "open": _rate(unique_opens, recipients),
        "click": _rate(unique_clicks, recipients),
        "reply": _rate(unique_replies, recipients),
        "registered": _rate(registered, enrolled),
        "unsubscribed": _rate(unsubscribed, enrolled),
    }

    by_step = []
    steps = db.scalars(
        select(CampaignStep).where(CampaignStep.campaign_id == campaign_id).order_by(CampaignStep.order)
    ).all()
    for step in steps:
        step_sent = db.scalar(
            select(func.count(ScheduledSend.id))
            .where(ScheduledSend.step_id == step.id, ScheduledSend.status == SendStatus.sent)
        ) or 0
        step_opens = db.scalar(
            select(func.count(distinct(Event.contact_id)))
            .join(ScheduledSend, Event.send_id == ScheduledSend.id)
            .where(ScheduledSend.step_id == step.id, Event.type == EventType.opened)
        ) or 0
        step_clicks = db.scalar(
            select(func.count(distinct(Event.contact_id)))
            .join(ScheduledSend, Event.send_id == ScheduledSend.id)
            .where(ScheduledSend.step_id == step.id, Event.type == EventType.clicked)
        ) or 0
        step_replies = db.scalar(
            select(func.count(distinct(Event.contact_id)))
            .join(ScheduledSend, Event.send_id == ScheduledSend.id)
            .where(ScheduledSend.step_id == step.id, Event.type == EventType.replied)
        ) or 0
        by_step.append({
            "order": step.order,
            "sent": step_sent,
            "opens": step_opens,
            "clicks": step_clicks,
            "replies": step_replies,
            "open_rate": _rate(step_opens, step_sent),
            "click_rate": _rate(step_clicks, step_sent),
            "reply_rate": _rate(step_replies, step_sent),
        })

    return {
        "sent": sent,
        "recipients": recipients,
        "opens": opens,
        "unique_opens": unique_opens,
        "clicks": clicks,
        "unique_clicks": unique_clicks,
        "replies": replies,
        "unique_replies": unique_replies,
        "enrolled": enrolled,
        "registered": registered,
        "unsubscribed": unsubscribed,
        "rates": rates,
        "by_step": by_step,
    }
