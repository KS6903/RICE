import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import require_roles
from ..models.activity import ActivityLog
from ..models.user import User

router = APIRouter()


def serialize_logs(db: Session, company_id: uuid.UUID, limit: int = 200) -> list[dict]:
    rows = (
        db.query(ActivityLog)
        .filter(ActivityLog.company_id == company_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
    user_ids = {r.user_id for r in rows if r.user_id}
    names: dict[uuid.UUID, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            names[u.id] = u.full_name or u.username
    return [
        {
            "id": str(r.id),
            "action": r.action,
            "user_name": names.get(r.user_id),
            "entity_type": r.entity_type,
            "entity_label": r.entity_label,
            "detail": r.detail,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/")
def list_activity(
    limit: int = Query(200, le=500),
    current_user=Depends(require_roles("owner", "admin")),
    db: Session = Depends(get_db),
):
    return serialize_logs(db, current_user.company_id, limit)
