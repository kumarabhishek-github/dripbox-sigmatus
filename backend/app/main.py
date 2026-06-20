from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import base64
import secrets as secrets_mod

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_setup import configure_logging

configure_logging()
logger = logging.getLogger("app")

from .config import settings
from .db import Base, engine, SessionLocal
from .migrations import apply_migrations
from .seed import seed_templates
from . import models  # noqa: F401  ensure models register
from .campaigns.scheduler import build_scheduler
from .campaigns.window import window_status

from .api import contacts as contacts_api
from .api import templates as templates_api
from .api import campaigns as campaigns_api
from .api import tracking as tracking_api
from .api import crm as crm_api
from .api import auth as auth_api
from .api import stats as stats_api
from .api import settings_api as settings_api_mod
from .gmail.auth import connection_ok
from .settings_store import resolve_email_creds
from .db import get_db
from fastapi import Depends
from sqlalchemy.orm import Session


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("data", exist_ok=True)
    Base.metadata.create_all(bind=engine)
    apply_migrations(engine)
    _db = SessionLocal()
    try:
        seed_templates(_db)
    finally:
        _db.close()
    scheduler = build_scheduler()
    scheduler.start()
    app.state.scheduler = scheduler
    try:
        yield
    finally:
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass


app = FastAPI(title="dripbox", lifespan=lifespan)

allowed_origins = {"http://localhost:5173", settings.BASE_URL.rstrip("/")}
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


PUBLIC_PREFIXES = ("/t/o/", "/t/of/", "/t/c/", "/api/health")


@app.middleware("http")
async def basic_auth_gate(request: Request, call_next):
    user = settings.BASIC_AUTH_USERNAME
    pwd = settings.BASIC_AUTH_PASSWORD
    if not user or not pwd:
        return await call_next(request)
    path = request.url.path
    if any(path.startswith(p) for p in PUBLIC_PREFIXES):
        return await call_next(request)
    header = request.headers.get("authorization", "")
    if header.startswith("Basic "):
        try:
            decoded = base64.b64decode(header[6:].encode("utf-8")).decode("utf-8")
            u, _, p = decoded.partition(":")
            if secrets_mod.compare_digest(u, user) and secrets_mod.compare_digest(p, pwd):
                return await call_next(request)
        except Exception:
            pass
    return Response(
        status_code=401,
        content="Authentication required",
        headers={"WWW-Authenticate": 'Basic realm="Campaign Monitor"'},
    )


@app.middleware("http")
async def request_logging(request: Request, call_next):
    rid = uuid.uuid4().hex[:8]
    start = time.time()
    body_preview = ""
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        raw = await request.body()

        async def receive():
            return {"type": "http.request", "body": raw, "more_body": False}

        request._receive = receive  # type: ignore[attr-defined]
        try:
            body_preview = raw.decode("utf-8", errors="replace")[:2000]
        except Exception:
            body_preview = f"<{len(raw)} bytes>"
    logger.info(
        "REQ %s %s %s body=%s", rid, request.method, request.url.path, body_preview or "-"
    )
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("ERR %s unhandled exception", rid)
        raise
    duration_ms = int((time.time() - start) * 1000)
    logger.info(
        "RES %s %s %s %d %dms", rid, request.method, request.url.path, response.status_code, duration_ms
    )
    return response


from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    logger.warning(
        "422 %s %s body=%s errors=%s",
        request.method,
        request.url.path,
        getattr(exc, "body", None),
        exc.errors(),
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/health/window")
def health_window():
    return window_status()


@app.get("/api/health/email")
def health_email(db: Session = Depends(get_db)):
    smtp_ok, imap_ok, error = connection_ok(db)
    creds = resolve_email_creds(db)
    return {
        "smtp_ok": smtp_ok,
        "imap_ok": imap_ok,
        "error": error,
        "sender_email": creds["sender_email"],
    }


app.include_router(contacts_api.router)
app.include_router(templates_api.router)
app.include_router(campaigns_api.router)
app.include_router(tracking_api.router)
app.include_router(crm_api.router)
app.include_router(auth_api.router)
app.include_router(stats_api.router)
app.include_router(settings_api_mod.router)


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            return await super().get_response("index.html", scope)


_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", SPAStaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
