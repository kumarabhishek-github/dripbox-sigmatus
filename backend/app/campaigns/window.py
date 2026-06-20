from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..settings_store import resolve_scheduling


def _is_in_window_local(now_local: datetime, sched: dict) -> bool:
    if sched["weekdays_only"] and now_local.weekday() >= 5:
        return False
    if now_local.hour < sched["hour_start"] or now_local.hour >= sched["hour_end"]:
        return False
    return True


def is_in_window(now_utc: datetime | None = None, db: Session | None = None) -> bool:
    """Check whether the given (or current) UTC time falls within the sending window."""
    sched = resolve_scheduling(db)
    if not sched["enabled"]:
        return True
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    elif now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    return _is_in_window_local(now_utc.astimezone(ZoneInfo(sched["timezone"])), sched)


def _next_window_start_local(after_local: datetime, sched: dict) -> datetime:
    """Return next valid window-start datetime (local tz), at or after `after_local`."""
    start_h = sched["hour_start"]
    end_h = sched["hour_end"]
    weekdays_only = sched["weekdays_only"]

    candidate = after_local
    if _is_in_window_local(candidate, sched):
        return candidate

    base = candidate.replace(minute=0, second=0, microsecond=0)
    if candidate.hour < start_h and (not weekdays_only or candidate.weekday() < 5):
        return base.replace(hour=start_h)

    day = (base + timedelta(days=1)).replace(hour=start_h)
    for _ in range(14):
        if not weekdays_only or day.weekday() < 5:
            if start_h < end_h:
                return day
        day = day + timedelta(days=1)
    return day


def next_in_window(dt_utc: datetime, db: Session | None = None) -> datetime:
    """If `dt_utc` is outside the send window, roll forward to the next valid in-window slot.

    Applies a random offset across the FULL configured window width so a narrow
    window (e.g. 9-10) still gets sends spread within it rather than all stacking
    at 09:xx.
    Returns a naive UTC datetime to match existing storage convention.
    """
    sched = resolve_scheduling(db)
    if not sched["enabled"]:
        return dt_utc.replace(tzinfo=None) if dt_utc.tzinfo else dt_utc

    tz = ZoneInfo(sched["timezone"])
    if dt_utc.tzinfo is None:
        aware = dt_utc.replace(tzinfo=timezone.utc)
    else:
        aware = dt_utc.astimezone(timezone.utc)

    local = aware.astimezone(tz)
    if _is_in_window_local(local, sched):
        return aware.astimezone(timezone.utc).replace(tzinfo=None)

    next_start_local = _next_window_start_local(local, sched)
    window_minutes = max(1, (sched["hour_end"] - sched["hour_start"]) * 60)
    jitter_minutes = random.randint(0, window_minutes - 1)
    next_start_local = next_start_local.replace(minute=0, second=0, microsecond=0) + timedelta(minutes=jitter_minutes)

    return next_start_local.astimezone(timezone.utc).replace(tzinfo=None)


def window_status(db: Session | None = None) -> dict:
    """Return current window status for health endpoints."""
    sched = resolve_scheduling(db)
    now_utc = datetime.now(timezone.utc)
    tz = ZoneInfo(sched["timezone"])
    now_local = now_utc.astimezone(tz)
    in_window = (
        True if not sched["enabled"] else _is_in_window_local(now_local, sched)
    )

    if not sched["enabled"]:
        next_start_iso = now_local.isoformat()
    else:
        next_start_local = _next_window_start_local(now_local, sched)
        next_start_iso = next_start_local.isoformat()

    return {
        "in_window": in_window,
        "next_window_start": next_start_iso,
        "timezone": sched["timezone"],
        "enabled": sched["enabled"],
        "hour_start": sched["hour_start"],
        "hour_end": sched["hour_end"],
        "weekdays_only": sched["weekdays_only"],
    }
