"""ActivityService — read/serialize side of the audit log (Phase 3b).

The write primitives (log_activity, purge_expired_branches) stay as shared
functions in services/activity.py: they're cross-cutting audit helpers that
deliberately enlist in each caller's transaction, used across domains
(branches, etc.). This service owns the read path consumed by the tenant
activity endpoint and the platform-admin tenant-detail view.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from typing import Any, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..core.exceptions import ValidationError
from ..models.activity import ActivityLog
from ..models.user import User
from ..repositories.activity import ActivityLogRepository
from ..services.base import BaseService

# The most days one look at the log covers, and what it shows unless asked: the
# last month (today and the 30 days before it).
MAX_RANGE_DAYS = 31


class ActivityService(BaseService):
    def __init__(self, db: Session, current_user: Any = None, *, activity: ActivityLogRepository | None = None) -> None:
        super().__init__(db, current_user)
        self.activity = activity or ActivityLogRepository(db)

    def list_recent(self, company_id: uuid.UUID, *, limit: int = 200) -> list[dict]:
        """Serialized recent audit rows for a company, newest first.

        ``company_id`` is explicit (not taken from current_user) because the
        platform-admin view reads another tenant's log.
        """
        return self._serialize(self.activity.list_recent_for_company(company_id, limit=limit))

    def list_between(
        self,
        company_id: uuid.UUID,
        zone: ZoneInfo,
        *,
        start: date | None = None,
        end: date | None = None,
        limit: int = 500,
    ) -> list[dict]:
        """Audit rows from the *start* day to the *end* day, both whole days in
        the mill's time zone, newest first. Without dates: the last month."""
        end = end or datetime.now(zone).date()
        start = start or end - timedelta(days=MAX_RANGE_DAYS - 1)
        if start > end:
            raise ValidationError("The start date is after the end date.")
        if (end - start).days + 1 > MAX_RANGE_DAYS:
            raise ValidationError(f"Pick up to {MAX_RANGE_DAYS} days at a time.")
        since = datetime.combine(start, time.min, zone)
        until = datetime.combine(end + timedelta(days=1), time.min, zone)
        return self._serialize(self.activity.list_for_company_between(company_id, since, until, limit=limit))

    def _serialize(self, rows: Sequence[ActivityLog]) -> list[dict]:
        user_ids = {r.user_id for r in rows if r.user_id}
        names: dict[uuid.UUID, str] = {}
        if user_ids:
            for u in self.db.query(User).filter(User.id.in_(user_ids)).all():
                names[u.id] = u.full_name or u.username
        return [
            {
                "id": str(r.id),
                "action": r.action,
                "user_name": names.get(r.user_id) if r.user_id else None,
                "entity_type": r.entity_type,
                "entity_label": r.entity_label,
                "detail": r.detail,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
