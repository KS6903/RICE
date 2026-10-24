"""Activity-log HTTP controller — thin routing over ActivityService (Phase 3b)."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_section_access
from ..core.timezones import tenant_zone
from ..services.activity_service import ActivityService

# Part of the mill's settings: whoever the Boss opened Settings to.
router = APIRouter(dependencies=[Depends(require_section_access("settings"))])


def get_activity_service(db: Session = Depends(get_db)) -> ActivityService:
    return ActivityService(db)


def serialize_logs(db: Session, company_id: uuid.UUID, limit: int = 200) -> list[dict]:
    """Backwards-compatible shim used by the platform-admin tenant view.

    Delegates to ActivityService so the serialization lives in one place.
    """
    return ActivityService(db).list_recent(company_id, limit=limit)


@router.get("/")
def list_activity(
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(500, ge=1, le=1000),
    current_user=Depends(get_current_user),
    svc: ActivityService = Depends(get_activity_service),
):
    """The mill's activity from *start* to *end* (whole days, in its own time
    zone): the last month unless asked, and at most 31 days at a time."""
    zone = tenant_zone(current_user.company.timezone)
    return svc.list_between(current_user.company_id, zone, start=start, end=end, limit=limit)
