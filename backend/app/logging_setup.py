from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path


_CONFIGURED = False


def configure_logging() -> Path:
    """Configure root logger to also write to data/app.log. Idempotent."""
    global _CONFIGURED
    log_path = Path("data") / "app.log"
    if _CONFIGURED:
        return log_path

    os.makedirs("data", exist_ok=True)

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(logging.DEBUG)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(fmt)
    stream_handler.setLevel(logging.INFO)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.handlers = [file_handler, stream_handler]

    # Bring uvicorn loggers into the same handlers
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "apscheduler"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
        lg.setLevel(logging.DEBUG if name != "uvicorn.access" else logging.INFO)

    _CONFIGURED = True
    logging.getLogger(__name__).info("Logging initialised. File: %s", log_path.resolve())
    return log_path
