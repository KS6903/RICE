"""Repository for the activity-log domain (Phase 3b)."""
from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.activity import ActivityLog
from .base import BaseRepository


class ActivityLogRepository(BaseRepository[ActivityLog]):
    model = ActivityLog

    def list_recent_for_company(self, company_id: uuid.UUID, *, limit: int = 200) -> Sequence[ActivityLog]:
        stmt = (
            select(ActivityLog)
            .where(ActivityLog.company_id == company_id)
            .order_by(ActivityLog.created_at.desc())
            .limit(limit)
        )
        return self.db.execute(stmt).scalars().all()
