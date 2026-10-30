"""Profit calculator HTTP controllers.

The page's section is closed to everyone but the Boss until the Boss opens it, and
even then only ``/varieties`` answers staff, in its lower-figure shape. The rest
are the Boss's alone: not ``require_roles``, which lets platform admins through.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..services.profit_service import ProfitService, is_boss

router = APIRouter(dependencies=[Depends(require_feature("profit")), Depends(require_section_access("profit"))])


def require_boss(current_user=Depends(get_current_user)):
    if not is_boss(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return current_user


BOSS_ONLY = [Depends(require_boss)]


class ProfitSettingsIn(BaseModel):
    # Under 100: the recommended price divides by what's left of it.
    target_margin_pct: float | None = Field(default=None, ge=0, le=90)
    staff_profit_pct: float | None = Field(default=None, ge=0, le=100)


def get_profit_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ProfitService:
    return ProfitService(db, current_user)


@router.get("/varieties")
def varieties(svc: ProfitService = Depends(get_profit_service)):
    return svc.varieties()


@router.get("/defaults", dependencies=BOSS_ONLY)
def defaults(variety_id: uuid.UUID = Query(...), svc: ProfitService = Depends(get_profit_service)):
    return svc.defaults(variety_id)


@router.get("/period", dependencies=BOSS_ONLY)
def period(
    start: date = Query(...),
    end: date = Query(...),
    svc: ProfitService = Depends(get_profit_service),
):
    return svc.period(start, end)


@router.get("/settings", dependencies=BOSS_ONLY)
def get_settings(svc: ProfitService = Depends(get_profit_service)):
    return svc.get_settings()


@router.put("/settings", dependencies=BOSS_ONLY)
def set_settings(body: ProfitSettingsIn, svc: ProfitService = Depends(get_profit_service)):
    return svc.set_settings(body.target_margin_pct, body.staff_profit_pct)
