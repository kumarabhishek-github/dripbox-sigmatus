from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Template, Contact
from ..schemas import TemplateCreate, TemplateUpdate, TemplateOut, PreviewOut
from ..campaigns.render import render_preview
from pydantic import BaseModel


class DuplicateTemplatePayload(BaseModel):
    name: Optional[str] = None


router = APIRouter(prefix="/api/templates", tags=["templates"])


def _validate_format(fmt: str) -> str:
    fmt = (fmt or "html").lower()
    if fmt not in {"html", "plaintext"}:
        raise HTTPException(400, "format must be 'html' or 'plaintext'")
    return fmt


@router.post("", response_model=TemplateOut)
def create_template(payload: TemplateCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(Template).where(Template.name == payload.name))
    if existing:
        raise HTTPException(409, "template name exists")
    fmt = _validate_format(payload.format)
    body = payload.body
    file_path = payload.file_path or ""
    if not body and not file_path:
        raise HTTPException(400, "provide either body or file_path")
    t = Template(
        name=payload.name,
        subject_template=payload.subject_template,
        body=body,
        format=fmt,
        file_path=file_path,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.get("", response_model=list[TemplateOut])
def list_templates(db: Session = Depends(get_db)):
    return db.scalars(select(Template).order_by(Template.id.desc())).all()


@router.get("/{template_id}", response_model=TemplateOut)
def get_template(template_id: int, db: Session = Depends(get_db)):
    t = db.get(Template, template_id)
    if not t:
        raise HTTPException(404, "template not found")
    return t


@router.patch("/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, payload: TemplateUpdate, db: Session = Depends(get_db)):
    t = db.get(Template, template_id)
    if not t:
        raise HTTPException(404, "template not found")
    if payload.name is not None:
        t.name = payload.name
    if payload.subject_template is not None:
        t.subject_template = payload.subject_template
    if payload.body is not None:
        t.body = payload.body
    if payload.format is not None:
        t.format = _validate_format(payload.format)
    db.commit()
    db.refresh(t)
    return t


@router.post("/{template_id}/duplicate", response_model=TemplateOut)
def duplicate_template(
    template_id: int,
    payload: DuplicateTemplatePayload,
    db: Session = Depends(get_db),
):
    src = db.get(Template, template_id)
    if not src:
        raise HTTPException(404, "template not found")
    new_name = (payload.name or f"{src.name} (copy)").strip()
    if not new_name:
        raise HTTPException(400, "name cannot be empty")
    if db.scalar(select(Template).where(Template.name == new_name)):
        raise HTTPException(409, "template name exists")
    dup = Template(
        name=new_name,
        subject_template=src.subject_template,
        body=src.body,
        format=src.format,
        file_path=src.file_path,
    )
    db.add(dup)
    db.commit()
    db.refresh(dup)
    return dup


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    t = db.get(Template, template_id)
    if not t:
        raise HTTPException(404, "template not found")
    db.delete(t)
    db.commit()
    return None


@router.get("/{template_id}/preview", response_model=PreviewOut)
def preview(
    template_id: int,
    contact_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    t = db.get(Template, template_id)
    if not t:
        raise HTTPException(404, "template not found")
    if contact_id is not None:
        c = db.get(Contact, contact_id)
        if not c:
            raise HTTPException(404, "contact not found")
    else:
        c = Contact(email="preview@example.com", name="Preview", custom_fields={})
    subject, body = render_preview(t, c)
    return PreviewOut(subject=subject, html=body, format=(t.format or "html"))
