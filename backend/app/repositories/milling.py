"""Repositories for the milling domain (Phase 3c)."""
from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.milling import MillingBatch, MillingEquipment
from .base import BaseRepository


class MillingEquipmentRepository(BaseRepository[MillingEquipment]):
    model = MillingEquipment

    def list_for_company(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[MillingEquipment]:
        stmt = select(MillingEquipment).where(MillingEquipment.company_id == company_id)
        if not include_inactive:
            stmt = stmt.where(MillingEquipment.is_active.is_(True))
        return self.db.execute(stmt.order_by(MillingEquipment.name)).scalars().all()


class MillingBatchRepository(BaseRepository[MillingBatch]):
    model = MillingBatch

    def list_for_company(self, company_id: uuid.UUID, *, skip: int = 0, limit: int = 50) -> Sequence[MillingBatch]:
        stmt = (
            select(MillingBatch)
            .where(MillingBatch.company_id == company_id)
            .order_by(MillingBatch.start_datetime.desc())
            .offset(skip)
            .limit(limit)
        )
        return self.db.execute(stmt).scalars().all()

    def count(self) -> int:
        """Total batch count across all tenants — drives the batch number sequence."""
        return self.db.query(MillingBatch).count()
