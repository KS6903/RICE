"""Repository for the activity-log domain (Phase 3b)."""

from __future__ import annotations

import uuid
from datetime import datetime
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

    def list_for_company_between(
        self, company_id: uuid.UUID, since: datetime, until: datetime, *, limit: int
    ) -> Sequence[ActivityLog]:
        """Rows from *since* up to, not including, *until*, newest first."""
        stmt = (
            select(ActivityLog)
            .where(
                ActivityLog.company_id == company_id,
                ActivityLog.created_at >= since,
                ActivityLog.created_at < until,
            )
            .order_by(ActivityLog.created_at.desc())
            .limit(limit)
        )
        return self.db.execute(stmt).scalars().all()
