"""Nightly SQLite snapshot job.

Uses sqlite3's online backup API so we get a consistent copy even if the
service is mid-write. Output filenames are timestamped; older backups beyond
BACKUP_RETAIN are deleted.
"""
from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from .config import settings

logger = logging.getLogger(__name__)


def _db_path() -> Path:
    url = settings.DATABASE_URL
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise RuntimeError(f"backup only supports sqlite URLs, got: {url}")
    return Path(url[len(prefix):])


def backup_once() -> Path:
    src = _db_path()
    if not src.exists():
        raise FileNotFoundError(f"sqlite db not found: {src}")
    dest_dir = Path(settings.BACKUP_DIR)
    dest_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    dest = dest_dir / f"app-{ts}.db"
    src_conn = sqlite3.connect(str(src))
    try:
        dest_conn = sqlite3.connect(str(dest))
        try:
            src_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        src_conn.close()
    _prune(dest_dir, settings.BACKUP_RETAIN)
    logger.info("backup: wrote %s (retained latest %d)", dest, settings.BACKUP_RETAIN)
    return dest


def _prune(dest_dir: Path, retain: int) -> None:
    files = sorted(
        (p for p in dest_dir.glob("app-*.db")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in files[retain:]:
        try:
            os.remove(old)
        except OSError:
            pass


def backup_job() -> None:
    if not settings.BACKUP_ENABLED:
        return
    try:
        backup_once()
    except Exception:
        logger.exception("backup: failed")
