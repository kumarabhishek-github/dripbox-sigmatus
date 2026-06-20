from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Contact, ContactStage, Event, EventType, Enrollment
from ..schemas import (
    ContactCreate, ContactUpdate, ContactOut, EventCreate, EventOut,
    TimelineOut, EnrollmentOut,
)
from ..crm.stages import set_stage, stop_active_enrollments


router = APIRouter(prefix="/api/contacts", tags=["contacts"])


@router.get("/sources")
def list_sources(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Contact.source).where(Contact.source.is_not(None)).distinct()
    ).all()
    return sorted(s for s in rows if s)


@router.post("", response_model=ContactOut)
def create_contact(payload: ContactCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(Contact).where(Contact.email == payload.email))
    if existing:
        raise HTTPException(409, "contact already exists")
    c = Contact(
        email=payload.email,
        name=payload.name,
        custom_fields=payload.custom_fields,
        stage=payload.stage,
        source=payload.source,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.get("")
def list_contacts(
    stage: Optional[ContactStage] = None,
    search: Optional[str] = None,
    source: Optional[str] = None,
    not_enrolled_in: Optional[int] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, le=1000),
    offset: Optional[int] = None,
    db: Session = Depends(get_db),
):
    filters = []
    if stage:
        filters.append(Contact.stage == stage)
    if source:
        filters.append(Contact.source == source)
    if search:
        like = f"%{search}%"
        filters.append(or_(Contact.email.ilike(like), Contact.name.ilike(like)))
    if not_enrolled_in is not None:
        already = select(Enrollment.contact_id).where(
            Enrollment.campaign_id == not_enrolled_in
        )
        filters.append(Contact.id.not_in(already))

    count_q = select(func.count()).select_from(Contact)
    for f in filters:
        count_q = count_q.where(f)
    total = db.scalar(count_q) or 0

    effective_offset = offset if offset is not None else (page - 1) * limit
    q = select(Contact)
    for f in filters:
        q = q.where(f)
    q = q.order_by(Contact.created_at.desc()).limit(limit).offset(effective_offset)
    items = db.scalars(q).all()
    return {
        "items": [ContactOut.model_validate(c).model_dump(mode="json") for c in items],
        "total": total,
    }


@router.get("/{contact_id}", response_model=ContactOut)
def get_contact(contact_id: int, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "not found")
    return c


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: int, payload: ContactUpdate, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "not found")
    if payload.name is not None:
        c.name = payload.name
    if payload.custom_fields is not None:
        c.custom_fields = payload.custom_fields
    if payload.source is not None:
        c.source = payload.source or None
    if payload.registered_at is not None:
        c.registered_at = payload.registered_at
    if payload.unsubscribed is not None:
        c.unsubscribed = payload.unsubscribed
        if payload.unsubscribed:
            stop_active_enrollments(db, c, "unsubscribed")
    if payload.stage is not None and payload.stage != c.stage:
        set_stage(db, c, payload.stage, reason="manual")
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "not found")
    db.delete(c)
    db.commit()
    return None


@router.post("/{contact_id}/events", response_model=EventOut)
def create_event(contact_id: int, payload: EventCreate, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "contact not found")
    ev = Event(
        contact_id=contact_id,
        send_id=payload.send_id,
        type=payload.type,
        data=payload.data,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


@router.get("/{contact_id}/timeline", response_model=TimelineOut)
def timeline(contact_id: int, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "not found")
    events = db.scalars(
        select(Event).where(Event.contact_id == contact_id).order_by(Event.created_at.desc())
    ).all()
    enrollments = db.scalars(
        select(Enrollment).where(Enrollment.contact_id == contact_id)
    ).all()
    return TimelineOut(
        events=[EventOut.model_validate(e) for e in events],
        enrollments=[EnrollmentOut.model_validate(e) for e in enrollments],
    )
