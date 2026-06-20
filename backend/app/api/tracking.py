from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import TrackingToken, TokenKind, Event, EventType, ScheduledSend
from ..tracking.pixel import PIXEL_GIF
from ..tracking.click import unsign_url
from ..crm.stages import auto_advance_on_event


router = APIRouter(tags=["tracking"])


@router.get("/t/o/{token}.gif")
def open_pixel(token: str, db: Session = Depends(get_db)):
    tt = db.scalar(select(TrackingToken).where(TrackingToken.token == token, TrackingToken.kind == TokenKind.open))
    headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache"}
    if not tt:
        return Response(content=PIXEL_GIF, media_type="image/gif", headers=headers)

    send = db.get(ScheduledSend, tt.send_id)
    if send:
        enrollment = send.enrollment
        contact = enrollment.contact
        existing = db.scalar(
            select(Event).where(
                Event.contact_id == contact.id,
                Event.send_id == send.id,
                Event.type == EventType.opened,
            )
        )
        db.add(Event(
            contact_id=contact.id,
            send_id=send.id,
            type=EventType.opened,
            data={"token": token},
        ))
        if not existing:
            auto_advance_on_event(db, contact, EventType.opened, enrollment=enrollment)
        db.commit()

    return Response(content=PIXEL_GIF, media_type="image/gif", headers=headers)


@router.get("/t/of/{token}")
def open_footer(token: str, db: Session = Depends(get_db)):
    """Plaintext-email footer link. Records an open event then redirects.

    Plaintext can't render a 1x1 pixel, so the only way to detect opens is to
    inject a 'view this email online' link that pings here on click.
    """
    from ..config import settings as _settings

    tt = db.scalar(select(TrackingToken).where(TrackingToken.token == token, TrackingToken.kind == TokenKind.open))
    if tt:
        send = db.get(ScheduledSend, tt.send_id)
        if send:
            enrollment = send.enrollment
            contact = enrollment.contact
            existing = db.scalar(
                select(Event).where(
                    Event.contact_id == contact.id,
                    Event.send_id == send.id,
                    Event.type == EventType.opened,
                )
            )
            db.add(Event(
                contact_id=contact.id,
                send_id=send.id,
                type=EventType.opened,
                data={"token": token, "source": "footer_link"},
            ))
            if not existing:
                auto_advance_on_event(db, contact, EventType.opened, enrollment=enrollment)
            db.commit()

    target = tt.url if (tt and tt.url) else _settings.BASE_URL
    return RedirectResponse(url=target, status_code=302)


@router.get("/t/c/{token}")
def click_redirect(token: str, u: Optional[str] = Query(None), db: Session = Depends(get_db)):
    tt = db.scalar(select(TrackingToken).where(TrackingToken.token == token, TrackingToken.kind == TokenKind.click))

    original_url: Optional[str] = tt.url if tt else None
    # Back-compat: older emails still carry a signed ?u=<dest> param. Trust the
    # DB-stored url when present; fall back to the signed param otherwise.
    if original_url is None and u is not None:
        try:
            original_url = unsign_url(u)
        except ValueError:
            return Response(content="Invalid link", status_code=400)

    if original_url is None:
        return Response(content="Invalid link", status_code=400)

    if tt:
        send = db.get(ScheduledSend, tt.send_id)
        if send:
            contact = send.enrollment.contact
            db.add(Event(
                contact_id=contact.id,
                send_id=send.id,
                type=EventType.clicked,
                data={"token": token, "url": original_url},
            ))
            db.commit()

    return RedirectResponse(url=original_url, status_code=302)
