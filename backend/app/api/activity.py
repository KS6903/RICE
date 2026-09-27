"""Activity-log HTTP controller — thin routing over ActivityService (Phase 3b)."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import require_roles, require_section_access
from ..services.activity_service import ActivityService

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
    limit: int = Query(200, le=500),
    current_user=Depends(require_roles("owner", "admin")),
    svc: ActivityService = Depends(get_activity_service),
):
    return svc.list_recent(current_user.company_id, limit=limit)
