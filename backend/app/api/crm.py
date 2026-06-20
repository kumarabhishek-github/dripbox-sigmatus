from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/crm", tags=["crm"])


@router.get("/stages")
def list_stages():
    from ..models import ContactStage
    return [s.value for s in ContactStage]
