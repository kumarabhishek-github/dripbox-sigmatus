from __future__ import annotations

import logging
import random
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..config import settings
from ..models import (
    ScheduledSend, SendStatus, Enrollment, EnrollmentStatus, ContactStage,
    Event, EventType, CampaignStatus,
)
from ..crm.stages import auto_advance_on_event
from .render import render_email, render_subject
from .enroll import enqueue_next_step
from ..gmail.send import send_email
from ..gmail.replies import poll_replies
from ..backup import backup_job
from .window import is_in_window
from ..models import RecipientStage
from ..settings_store import resolve_scheduling, resolve_daily_send_cap


logger = logging.getLogger(__name__)


SKIP_RECIPIENT_STAGES = {RecipientStage.replied}
SKIP_CONTACT_STAGES = {ContactStage.registered, ContactStage.lost}


def _thread_context(db: Session, enrollment: Enrollment) -> tuple[str | None, str | None, str | None]:
    """Threading info for the next send in this enrollment.

    Returns (in_reply_to, references, subject_override). When the campaign has
    thread_emails enabled and at least one message has already gone out for this
    enrollment, this chains the new send onto that thread: In-Reply-To points at
    the most recent sent message, References is the full ordered chain, and the
    subject is forced to the thread root's "Re:"-prefixed subject (Gmail keys on
    both the headers and a matching subject). Returns all None for thread-disabled
    campaigns or the first send (which becomes the thread root).
    """
    if not enrollment.campaign.thread_emails:
        return None, None, None

    prior = db.scalars(
        select(ScheduledSend)
        .where(
            ScheduledSend.enrollment_id == enrollment.id,
            ScheduledSend.status == SendStatus.sent,
            ScheduledSend.gmail_message_id.isnot(None),
        )
        .order_by(ScheduledSend.sent_at.asc())
    ).all()
    ids = [p.gmail_message_id for p in prior if p.gmail_message_id]
    if not ids:
        return None, None, None

    # Reuse the subject Gmail actually indexed on the thread root. Read back the
    # stored sent subject; only fall back to re-rendering for rows sent before the
    # sent_subject column existed (where a since-edited template could diverge).
    root = prior[0]
    root_subject = root.sent_subject or render_subject(root.step.template, enrollment.contact)
    if not root_subject.lstrip().lower().startswith("re:"):
        root_subject = f"Re: {root_subject}"
    return ids[-1], " ".join(ids), root_subject


def _sends_today(db: Session) -> int:
    start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(
        select(func.count(ScheduledSend.id)).where(
            ScheduledSend.status == SendStatus.sent,
            ScheduledSend.sent_at >= start,
        )
    ) or 0


def tick_send_queue() -> None:
    # Respect the business-hours sending window. Pending sends are left untouched
    # and will be picked up on the next in-window tick.
    sched = resolve_scheduling()
    if sched["enabled"]:
        tz = ZoneInfo(sched["timezone"])
        now_local = datetime.now(tz)
        if sched["weekdays_only"] and now_local.weekday() >= 5:
            logger.debug("send tick skipped: weekend in %s", sched["timezone"])
            return
        if now_local.hour < sched["hour_start"] or now_local.hour >= sched["hour_end"]:
            logger.debug(
                "send tick skipped: %s outside %d-%d in %s",
                now_local.isoformat(), sched["hour_start"], sched["hour_end"],
                sched["timezone"],
            )
            return

    db: Session = SessionLocal()
    try:
        sent_today = _sends_today(db)
        remaining = resolve_daily_send_cap(db) - sent_today
        if remaining <= 0:
            return

        # Cap how many we process this tick so we don't block the scheduler thread too long.
        batch_limit = min(remaining, settings.MAX_SENDS_PER_TICK)

        now = datetime.utcnow()
        pending = db.scalars(
            select(ScheduledSend)
            .where(ScheduledSend.send_at <= now, ScheduledSend.status == SendStatus.pending)
            .order_by(ScheduledSend.send_at.asc())
            .limit(batch_limit)
        ).all()

        jitter_min = settings.SEND_JITTER_MIN_SECONDS
        jitter_max = settings.SEND_JITTER_MAX_SECONDS
        total = len(pending)

        for idx, s in enumerate(pending):
            try:
                enrollment = s.enrollment
                contact = enrollment.contact
                campaign = enrollment.campaign

                reasons = []
                if contact.unsubscribed:
                    reasons.append("contact unsubscribed")
                if enrollment.stage in SKIP_RECIPIENT_STAGES:
                    reasons.append(f"recipient stage={enrollment.stage.value}")
                if contact.stage in SKIP_CONTACT_STAGES:
                    reasons.append(f"contact stage={contact.stage.value}")
                if enrollment.status != EnrollmentStatus.active:
                    reasons.append(f"enrollment status={enrollment.status.value}")
                if campaign.status != CampaignStatus.active:
                    reasons.append(f"campaign status={campaign.status.value}")
                if reasons:
                    s.status = SendStatus.skipped
                    s.error = "skipped: " + "; ".join(reasons)
                    db.commit()
                    continue

                step = s.step
                template = step.template
                subject, body, fmt = render_email(db, template, contact, s)
                in_reply_to, references, subject_override = _thread_context(db, enrollment)
                if subject_override is not None:
                    subject = subject_override
                db.flush()

                msg_id, thread_id = send_email(
                    contact.email, subject, body, fmt,
                    in_reply_to=in_reply_to, references=references,
                )
                s.gmail_message_id = msg_id
                s.gmail_thread_id = thread_id
                s.sent_subject = subject
                s.status = SendStatus.sent
                s.sent_at = datetime.utcnow()

                db.add(Event(
                    contact_id=contact.id,
                    send_id=s.id,
                    type=EventType.sent,
                    data={"gmail_message_id": msg_id, "thread_id": thread_id},
                ))

                auto_advance_on_event(db, contact, EventType.sent, enrollment=enrollment)
                enqueue_next_step(db, enrollment, step)

                db.commit()
            except Exception as e:
                db.rollback()
                s2 = db.get(ScheduledSend, s.id)
                if s2:
                    s2.status = SendStatus.failed
                    s2.error = str(e)[:1000]
                    db.commit()

            # Jitter between sends to look less automated. NOTE: APScheduler tick is single-threaded,
            # so sleeping here blocks the next tick. With max=120s and batch of 5 that's up to ~10 min
            # of tick time -- intentional, spreads sends across the day rather than firing the batch instantly.
            if idx < total - 1 and (jitter_min > 0 or jitter_max > 0):
                lo, hi = sorted((jitter_min, jitter_max))
                time.sleep(random.uniform(lo, hi))
    finally:
        db.close()


def send_one_now(db: Session, send_id: int) -> ScheduledSend:
    """Immediately send a pending scheduled email, bypassing window/cap/jitter.

    Eligibility checks (unsubscribed / stage / enrollment / campaign status)
    still apply; the send is marked 'skipped' if any fail.
    """
    s = db.get(ScheduledSend, send_id)
    if s is None:
        raise ValueError("send not found")
    if s.status != SendStatus.pending:
        raise ValueError(f"send is already {s.status.value}")

    enrollment = s.enrollment
    contact = enrollment.contact
    campaign = enrollment.campaign

    reasons = []
    if contact.unsubscribed:
        reasons.append("contact unsubscribed")
    if enrollment.stage in SKIP_RECIPIENT_STAGES:
        reasons.append(f"recipient stage={enrollment.stage.value}")
    if contact.stage in SKIP_CONTACT_STAGES:
        reasons.append(f"contact stage={contact.stage.value}")
    if enrollment.status != EnrollmentStatus.active:
        reasons.append(f"enrollment status={enrollment.status.value}")
    if campaign.status != CampaignStatus.active:
        reasons.append(f"campaign status={campaign.status.value}")
    if reasons:
        s.status = SendStatus.skipped
        s.error = "skipped: " + "; ".join(reasons)
        db.commit()
        return s

    try:
        step = s.step
        template = step.template
        subject, body, fmt = render_email(db, template, contact, s)
        in_reply_to, references, subject_override = _thread_context(db, enrollment)
        if subject_override is not None:
            subject = subject_override
        db.flush()

        msg_id, thread_id = send_email(
            contact.email, subject, body, fmt,
            in_reply_to=in_reply_to, references=references,
        )
        s.gmail_message_id = msg_id
        s.gmail_thread_id = thread_id
        s.sent_subject = subject
        s.status = SendStatus.sent
        s.sent_at = datetime.utcnow()

        db.add(Event(
            contact_id=contact.id,
            send_id=s.id,
            type=EventType.sent,
            data={"gmail_message_id": msg_id, "thread_id": thread_id},
        ))

        auto_advance_on_event(db, contact, EventType.sent, enrollment=enrollment)
        enqueue_next_step(db, enrollment, step)

        db.commit()
        return s
    except Exception as e:
        db.rollback()
        s2 = db.get(ScheduledSend, send_id)
        if s2:
            s2.status = SendStatus.failed
            s2.error = str(e)[:1000]
            db.commit()
        raise


def blast_pending_sends(send_ids: list[int]) -> None:
    """Fire a list of pending sends back-to-back from a daemon thread.

    Spaces sends by random.uniform(SEND_JITTER_MIN_SECONDS, SEND_JITTER_MAX_SECONDS)
    so it doesn't look mechanical. Each send uses its own DB session.
    Eligibility checks inside send_one_now still apply (unsubscribed contacts,
    paused campaigns, etc. get marked skipped).
    """
    import threading

    def _worker() -> None:
        lo = settings.SEND_JITTER_MIN_SECONDS
        hi = settings.SEND_JITTER_MAX_SECONDS
        total = len(send_ids)
        logger.info("send-all: starting blast of %d sends", total)
        for idx, sid in enumerate(send_ids):
            db = SessionLocal()
            try:
                send_one_now(db, sid)
            except Exception:
                logger.exception("send-all: failed send_id=%s", sid)
            finally:
                db.close()
            if idx < total - 1 and (lo > 0 or hi > 0):
                a, b = sorted((lo, hi))
                time.sleep(random.uniform(a, b))
        logger.info("send-all: completed blast of %d sends", total)

    t = threading.Thread(target=_worker, daemon=True, name="send-all-blast")
    t.start()


def poll_replies_job() -> None:
    db: Session = SessionLocal()
    try:
        poll_replies(db)
    except Exception:
        db.rollback()
    finally:
        db.close()


def build_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(tick_send_queue, "interval", minutes=1, id="tick_send_queue", max_instances=1, coalesce=True)
    scheduler.add_job(poll_replies_job, "interval", minutes=5, id="poll_replies", max_instances=1, coalesce=True)
    scheduler.add_job(
        backup_job,
        "cron",
        hour=settings.BACKUP_HOUR_UTC,
        minute=0,
        id="nightly_backup",
        max_instances=1,
        coalesce=True,
    )
    return scheduler
