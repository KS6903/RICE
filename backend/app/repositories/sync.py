"""Repositories for the offline-sync domain (Phase 3)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Sequence

from sqlalchemy import select

from ..models.sync import SyncConflict, SyncLog
from .base import BaseRepository


class SyncLogRepository(BaseRepository[SyncLog]):
    model = SyncLog

    def pull_since(
        self,
        company_id: uuid.UUID,
        since: datetime,
        *,
        until: datetime,
        tables: Sequence[str],
        limit: int = 500,
    ) -> Sequence[SyncLog]:
        stmt = (
            select(SyncLog)
            .where(
                SyncLog.company_id == company_id,
                SyncLog.synced_at > since,
                SyncLog.synced_at <= until,
                SyncLog.table_name.in_(tables),
            )
            .order_by(SyncLog.synced_at, SyncLog.id)
            .limit(limit)
        )
        return self.db.execute(stmt).scalars().all()


class SyncConflictRepository(BaseRepository[SyncConflict]):
    model = SyncConflict

    def list_unresolved(self, company_id: uuid.UUID) -> Sequence[SyncConflict]:
        stmt = select(SyncConflict).where(SyncConflict.company_id == company_id, SyncConflict.resolved_at.is_(None))
        return self.db.execute(stmt).scalars().all()
