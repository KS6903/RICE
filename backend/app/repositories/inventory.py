"""Repositories for the inventory domain (Phase 3a).

Milled-rice and by-product stock access. Palay stock reuses
PalayInventoryRepository from the paddy domain (it's the same table). Writes
flush only — InventoryService owns the transaction.
"""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..core.branch_scope import viewed_branch
from ..models.milling import ByproductInventory, MilledRiceInventory
from .base import BaseRepository


class MilledRiceInventoryRepository(BaseRepository[MilledRiceInventory]):
    model = MilledRiceInventory

    def list_with_stock(
        self, company_id: uuid.UUID, *, branch_id: uuid.UUID | None = None, warehouse_id: uuid.UUID | None = None
    ) -> Sequence[MilledRiceInventory]:
        stmt = select(MilledRiceInventory).where(
            MilledRiceInventory.company_id == company_id, MilledRiceInventory.quantity_kg > 0
        )
        branch_id = branch_id or viewed_branch(self.db)
        if branch_id:
            stmt = stmt.where(MilledRiceInventory.branch_id == branch_id)
        if warehouse_id:
            stmt = stmt.where(MilledRiceInventory.warehouse_id == warehouse_id)
        return self.db.execute(stmt).scalars().all()

    def find_bucket(
        self, company_id, branch_id, variety_id, grade_name, warehouse_id=None
    ) -> MilledRiceInventory | None:
        stmt = select(MilledRiceInventory).where(
            MilledRiceInventory.company_id == company_id,
            MilledRiceInventory.branch_id == branch_id,
            MilledRiceInventory.variety_id == variety_id,
            MilledRiceInventory.grade_name == grade_name,
        )
        if warehouse_id is not None:
            stmt = stmt.where(MilledRiceInventory.warehouse_id == warehouse_id)
        return self.db.execute(stmt).scalars().first()


class ByproductInventoryRepository(BaseRepository[ByproductInventory]):
    model = ByproductInventory

    def list_for_company(
        self, company_id: uuid.UUID, *, branch_id: uuid.UUID | None = None, warehouse_id: uuid.UUID | None = None
    ) -> Sequence[ByproductInventory]:
        stmt = select(ByproductInventory).where(ByproductInventory.company_id == company_id)
        branch_id = branch_id or viewed_branch(self.db)
        if branch_id:
            stmt = stmt.where(ByproductInventory.branch_id == branch_id)
        if warehouse_id:
            stmt = stmt.where(ByproductInventory.warehouse_id == warehouse_id)
        return self.db.execute(stmt).scalars().all()

    def find_bucket(self, company_id, branch_id, byproduct_type, warehouse_id=None) -> ByproductInventory | None:
        stmt = select(ByproductInventory).where(
            ByproductInventory.company_id == company_id,
            ByproductInventory.branch_id == branch_id,
            ByproductInventory.byproduct_type == byproduct_type,
        )
        if warehouse_id is not None:
            stmt = stmt.where(ByproductInventory.warehouse_id == warehouse_id)
        return self.db.execute(stmt).scalars().first()
