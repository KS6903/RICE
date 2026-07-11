"""Drying Advisor HTTP controller — Enterprise-only palay sun-drying advisory."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from ..core.config import settings
from ..core.ratelimit import limiter
from ..core.security import get_current_user, require_feature, require_section_access
from ..services.drying_advisor_service import DryingAdvisorService

router = APIRouter(
    dependencies=[
        Depends(require_section_access("dashboard")),
        Depends(require_feature("drying_advisor")),
    ]
)


def get_drying_advisor_service() -> DryingAdvisorService:
    return DryingAdvisorService()


@router.get("/drying-advisory")
@limiter.limit(settings.RATE_LIMIT_DRYING_ADVISOR)
def get_drying_advisory(
    request: Request,
    lat: float | None = Query(None, ge=-90.0, le=90.0, description="Optional latitude override"),
    lon: float | None = Query(None, ge=-180.0, le=180.0, description="Optional longitude override"),
    _user=Depends(get_current_user),
    svc: DryingAdvisorService = Depends(get_drying_advisor_service),
) -> dict[str, Any]:
    """Sun-drying recommendation for the client's location (IP-resolved unless
    explicit lat/lon are passed), derived from the same forecast the weather
    widget shows. Cached for hours per location/day; rate-limited since each
    fresh call costs a DeepSeek request."""
    return svc.get_advisory(request, lat, lon)
