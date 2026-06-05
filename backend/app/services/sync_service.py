"""SyncService — offline-sync push/pull and conflict resolution (Phase 3)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ..models.sync import SyncConflict, SyncLog
from ..repositories.sync import SyncConflictRepository, SyncLogRepository
from ..services.base import BaseService


class SyncService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        logs: SyncLogRepository,
        conflicts: SyncConflictRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.logs = logs
        self.conflicts = conflicts

    def push(self, client_id: str, records) -> dict:
        synced = 0
        with self.transaction():
            for record in records:
                self.db.add(
                    SyncLog(
                        company_id=self.current_user.company_id,
                        table_name=record.table_name,
                        record_id=record.record_id,
                        operation=record.operation,
                        payload=record.payload,
                        client_id=client_id,
                        synced_at=datetime.now(timezone.utc),
                    )
                )
                synced += 1
        return {"synced": synced, "conflicts": 0}

    def pull(self, since: datetime) -> dict:
        logs = self.logs.pull_since(self.current_user.company_id, since)
        return {
            "records": [
                {
                    "table_name": log.table_name,
                    "record_id": str(log.record_id),
                    "operation": log.operation,
                    "payload": log.payload,
                    "synced_at": log.synced_at.isoformat(),
                }
                for log in logs
            ],
            "server_time": datetime.now(timezone.utc).isoformat(),
        }

    def list_conflicts(self) -> Sequence[SyncConflict]:
        return self.conflicts.list_unresolved(self.current_user.company_id)

    def resolve_conflict(self, conflict_id: uuid.UUID, resolution: str) -> dict:
        conflict = self.conflicts.get_for_company(conflict_id, self.current_user.company_id)
        if not conflict:
            return {"resolved": False}
        with self.transaction():
            conflict.resolved_at = datetime.now(timezone.utc)
            conflict.resolved_by = self.current_user.id
            conflict.resolution = resolution
        return {"resolved": True}
