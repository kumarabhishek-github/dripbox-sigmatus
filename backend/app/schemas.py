from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, EmailStr, ConfigDict

from .models import (
    ContactStage, RecipientStage, CampaignStatus, EnrollmentStatus, SendStatus, EventType,
)


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# Contact
class ContactCreate(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    business_name: Optional[str] = None
    custom_fields: dict[str, Any] = {}
    stage: ContactStage = ContactStage.new
    source: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    business_name: Optional[str] = None
    custom_fields: Optional[dict[str, Any]] = None
    stage: Optional[ContactStage] = None
    registered_at: Optional[datetime] = None
    unsubscribed: Optional[bool] = None
    source: Optional[str] = None


class ContactOut(ORMBase):
    id: int
    email: str
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    business_name: Optional[str] = None
    custom_fields: dict[str, Any]
    stage: ContactStage
    registered_at: Optional[datetime]
    unsubscribed: bool
    source: Optional[str]
    created_at: datetime


class ContactImportItem(BaseModel):
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    business_name: Optional[str] = None


class ContactImportRequest(BaseModel):
    contacts: list[ContactImportItem]


class ContactImportResponse(BaseModel):
    imported: int
    skipped: int


# Template
class TemplateCreate(BaseModel):
    name: str
    subject_template: str
    body: Optional[str] = None
    format: str = "html"
    file_path: Optional[str] = None


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    subject_template: Optional[str] = None
    body: Optional[str] = None
    format: Optional[str] = None


class TemplateOut(ORMBase):
    id: int
    name: str
    file_path: str
    subject_template: str
    body: Optional[str] = None
    format: str = "html"


# Campaign
class CampaignStepIn(BaseModel):
    order: int
    template_id: int
    day_offset: int = 0


class CampaignStepOut(ORMBase):
    id: int
    order: int
    template_id: int
    day_offset: int


class CampaignCreate(BaseModel):
    name: str
    status: CampaignStatus = CampaignStatus.draft
    thread_emails: bool = False


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[CampaignStatus] = None
    thread_emails: Optional[bool] = None


class CampaignOut(ORMBase):
    id: int
    name: str
    status: CampaignStatus
    thread_emails: bool
    created_at: datetime
    steps: list[CampaignStepOut] = []


class EnrollRequest(BaseModel):
    contact_ids: Optional[list[int]] = None
    filter: Optional[dict[str, Any]] = None


# Events
class EventOut(ORMBase):
    id: int
    contact_id: int
    send_id: Optional[int]
    type: EventType
    data: dict[str, Any]
    created_at: datetime


class EventCreate(BaseModel):
    type: EventType
    data: dict[str, Any] = {}
    send_id: Optional[int] = None


class EnrollmentOut(ORMBase):
    id: int
    contact_id: int
    campaign_id: int
    status: EnrollmentStatus
    stage: RecipientStage = RecipientStage.pending
    stopped_reason: Optional[str]
    enrolled_at: datetime


class TimelineOut(BaseModel):
    events: list[EventOut]
    enrollments: list[EnrollmentOut]


class SettingIn(BaseModel):
    key: str
    value: Any


class SettingOut(BaseModel):
    key: str
    value: Any


class PreviewOut(BaseModel):
    subject: str
    html: str
    format: str = "html"
