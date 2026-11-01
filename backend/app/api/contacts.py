from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Contact, ContactStage, Event, EventType, Enrollment
from ..schemas import (
    ContactCreate, ContactUpdate, ContactOut, EventCreate, EventOut,
    TimelineOut, EnrollmentOut, ContactImportRequest, ContactImportResponse,
)
from ..crm.stages import set_stage, stop_active_enrollments


EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _compute_name(
    first_name: Optional[str],
    last_name: Optional[str],
    business_name: Optional[str] = None,
    fallback_name: Optional[str] = None,
) -> Optional[str]:
    parts = [p.strip() for p in (first_name, last_name) if p and p.strip()]
    if parts:
        return " ".join(parts)
    if fallback_name and fallback_name.strip():
        return fallback_name.strip()
    if business_name and business_name.strip():
        return business_name.strip()
    return None


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

    first_name = payload.first_name.strip() if payload.first_name else None
    last_name = payload.last_name.strip() if payload.last_name else None
    business_name = payload.business_name.strip() if payload.business_name else None
    name = _compute_name(first_name, last_name, business_name, payload.name)

    c = Contact(
        email=payload.email,
        name=name,
        first_name=first_name,
        last_name=last_name,
        business_name=business_name,
        custom_fields=payload.custom_fields,
        stage=payload.stage,
        source=payload.source,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.post("/import", response_model=ContactImportResponse)
def import_contacts(payload: ContactImportRequest, db: Session = Depends(get_db)):
    imported = 0
    skipped = 0
    seen_in_batch: set[str] = set()

    for item in payload.contacts:
        raw_email = (item.email or "").strip().lower()
        if not raw_email or not EMAIL_REGEX.match(raw_email):
            skipped += 1
            continue

        if raw_email in seen_in_batch:
            skipped += 1
            continue
        seen_in_batch.add(raw_email)

        existing = db.scalar(select(Contact.id).where(Contact.email == raw_email))
        if existing:
            skipped += 1
            continue

        first_name = item.first_name.strip() if item.first_name else None
        last_name = item.last_name.strip() if item.last_name else None
        business_name = item.business_name.strip() if item.business_name else None
        name = _compute_name(first_name, last_name, business_name)

        c = Contact(
            email=raw_email,
            name=name,
            first_name=first_name,
            last_name=last_name,
            business_name=business_name,
            stage=ContactStage.new,
            source="import",
        )
        db.add(c)
        imported += 1

    if imported > 0:
        db.commit()

    return ContactImportResponse(imported=imported, skipped=skipped)


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
        filters.append(
            or_(
                Contact.email.ilike(like),
                Contact.name.ilike(like),
                Contact.first_name.ilike(like),
                Contact.last_name.ilike(like),
                Contact.business_name.ilike(like),
            )
        )
    if not_enrolled_in is not None:
        already = select(Enrollment.contact_id).where(
            Enrollment.campaign_id == not_enrolled_in
        )
        filters.append(Contact.id.not_in(already))

    count_q = select(func.count()).select_from(Contact)
    for f in filters:
        count_q = count_q.where(f)
    total = db.scalar(count_q) or 0

    effective_page = page if isinstance(page, int) else 1
    effective_limit = limit if isinstance(limit, int) else 50
    effective_offset = offset if offset is not None else (effective_page - 1) * effective_limit
    q = select(Contact)
    for f in filters:
        q = q.where(f)
    q = q.order_by(Contact.created_at.desc()).limit(effective_limit).offset(effective_offset)
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

    name_field_updated = False
    if payload.first_name is not None:
        c.first_name = payload.first_name.strip() if payload.first_name else None
        name_field_updated = True
    if payload.last_name is not None:
        c.last_name = payload.last_name.strip() if payload.last_name else None
        name_field_updated = True
    if payload.business_name is not None:
        c.business_name = payload.business_name.strip() if payload.business_name else None
        name_field_updated = True

    if payload.name is not None:
        c.name = payload.name.strip() if payload.name else None
    elif name_field_updated:
        c.name = _compute_name(c.first_name, c.last_name, c.business_name, c.name)

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
