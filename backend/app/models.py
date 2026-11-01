from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional, Any

from sqlalchemy import (
    String, Integer, DateTime, ForeignKey, Boolean, JSON, Enum as SAEnum,
    UniqueConstraint, Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class ContactStage(str, enum.Enum):
    new = "new"
    contacted = "contacted"
    opened = "opened"
    replied = "replied"
    interested = "interested"
    registered = "registered"
    lost = "lost"


class RecipientStage(str, enum.Enum):
    """Per-enrollment engagement state. Tracks where this recipient sits in
    the campaign sequence, independent of the contact's overall CRM stage."""
    pending = "pending"
    sent = "sent"
    opened = "opened"
    replied = "replied"


class CampaignStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    paused = "paused"


class EnrollmentStatus(str, enum.Enum):
    active = "active"
    stopped = "stopped"
    completed = "completed"


class SendStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    skipped = "skipped"
    failed = "failed"


class EventType(str, enum.Enum):
    sent = "sent"
    opened = "opened"
    clicked = "clicked"
    replied = "replied"
    bounced = "bounced"
    unsubscribed = "unsubscribed"
    stage_change = "stage_change"


class TokenKind(str, enum.Enum):
    open = "open"
    click = "click"


def utcnow() -> datetime:
    return datetime.utcnow()


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(255))
    first_name: Mapped[Optional[str]] = mapped_column(String(255))
    last_name: Mapped[Optional[str]] = mapped_column(String(255))
    business_name: Mapped[Optional[str]] = mapped_column(String(255))
    custom_fields: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    stage: Mapped[ContactStage] = mapped_column(SAEnum(ContactStage), default=ContactStage.new, nullable=False)
    registered_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    unsubscribed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source: Mapped[Optional[str]] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="contact", cascade="all, delete-orphan")
    events: Mapped[list["Event"]] = relationship(back_populates="contact", cascade="all, delete-orphan")


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    # file_path is set when the template body lives on disk (legacy/seeded).
    # When the body is authored in-app it's stored in `body` and file_path is "".
    file_path: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    subject_template: Mapped[str] = mapped_column(String(512), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(Text)
    format: Mapped[str] = mapped_column(String(16), nullable=False, default="html")


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[CampaignStatus] = mapped_column(SAEnum(CampaignStatus), default=CampaignStatus.draft, nullable=False)
    # When true, every step after the first is sent as a reply to the enrollment's
    # first message (In-Reply-To/References headers + reused "Re:" subject) so the
    # whole sequence lands in one conversation thread.
    thread_emails: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    steps: Mapped[list["CampaignStep"]] = relationship(back_populates="campaign", cascade="all, delete-orphan", order_by="CampaignStep.order")
    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="campaign", cascade="all, delete-orphan")


class CampaignStep(Base):
    __tablename__ = "campaign_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id"), nullable=False)
    day_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    campaign: Mapped["Campaign"] = relationship(back_populates="steps")
    template: Mapped["Template"] = relationship()


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("contact_id", "campaign_id", name="uq_enrollment"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id"), nullable=False)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), nullable=False)
    status: Mapped[EnrollmentStatus] = mapped_column(SAEnum(EnrollmentStatus), default=EnrollmentStatus.active, nullable=False)
    stopped_reason: Mapped[Optional[str]] = mapped_column(String(255))
    enrolled_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    stage: Mapped[RecipientStage] = mapped_column(
        SAEnum(RecipientStage, native_enum=False, validate_strings=True),
        default=RecipientStage.pending,
        nullable=False,
    )

    contact: Mapped["Contact"] = relationship(back_populates="enrollments")
    campaign: Mapped["Campaign"] = relationship(back_populates="enrollments")
    sends: Mapped[list["ScheduledSend"]] = relationship(back_populates="enrollment", cascade="all, delete-orphan")


class ScheduledSend(Base):
    __tablename__ = "scheduled_sends"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enrollment_id: Mapped[int] = mapped_column(ForeignKey("enrollments.id"), nullable=False)
    step_id: Mapped[int] = mapped_column(ForeignKey("campaign_steps.id"), nullable=False)
    send_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    status: Mapped[SendStatus] = mapped_column(SAEnum(SendStatus), default=SendStatus.pending, nullable=False)
    gmail_message_id: Mapped[Optional[str]] = mapped_column(String(255))
    gmail_thread_id: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    # Subject line as actually rendered and sent. Read back by threaded follow-ups
    # to reuse the thread root's subject, so editing the template after the first
    # send can't desync the subject Gmail keyed the thread on.
    sent_subject: Mapped[Optional[str]] = mapped_column(Text)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    error: Mapped[Optional[str]] = mapped_column(Text)

    enrollment: Mapped["Enrollment"] = relationship(back_populates="sends")
    step: Mapped["CampaignStep"] = relationship()


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id"), nullable=False)
    send_id: Mapped[Optional[int]] = mapped_column(ForeignKey("scheduled_sends.id"))
    type: Mapped[EventType] = mapped_column(SAEnum(EventType), nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)

    contact: Mapped["Contact"] = relationship(back_populates="events")
    send: Mapped[Optional["ScheduledSend"]] = relationship()


class TrackingToken(Base):
    __tablename__ = "tracking_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    send_id: Mapped[int] = mapped_column(ForeignKey("scheduled_sends.id"), nullable=False)
    kind: Mapped[TokenKind] = mapped_column(SAEnum(TokenKind), nullable=False)
    url: Mapped[Optional[str]] = mapped_column(Text)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)

