"""Notifications HTTP controller: the signed-in user's own notices, and nobody else's."""

import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user
from ..models.notification import Notification
from ..services import notification_service

router = APIRouter()


class MarkRead(BaseModel):
    # The notices to mark read; leave it out to mark all of them.
    ids: list[uuid.UUID] | None = None


def _serialize(notice: Notification) -> dict:
    return {
        "id": str(notice.id),
        "kind": notice.kind,
        "title": notice.title,
        "body": notice.body,
        "link": notice.link,
        "created_at": notice.created_at.isoformat(),
        "read": notice.read_at is not None,
    }


@router.get("/")
def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Platform admins belong to no tenant, so they have no tenant notices.
    if current_user.company_id is None:
        return {"items": [], "unread": 0}
    return {
        "items": [_serialize(n) for n in notification_service.recent(db, current_user.id, limit=limit)],
        "unread": notification_service.unread_count(db, current_user.id),
    }


@router.post("/read")
def mark_read(body: MarkRead, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.company_id is None:
        return {"updated": 0}
    updated = notification_service.mark_read(db, current_user.id, body.ids)
    db.commit()
    return {"updated": updated}
