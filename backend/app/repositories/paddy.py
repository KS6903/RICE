"""Repositories for the paddy domain (Phase 2.2).

Encapsulate every ``db.query`` the paddy routes/services used to run inline.
Reads that mix tenant rows with shared/system rows (``company_id IS NULL``) are
expressed here once. Writes flush only — PaddyService owns the transaction.
"""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import joinedload, selectinload

from ..core.branch_scope import only_viewed, viewed_branch
from ..models.paddy import PalayInventory, PalayPurchase, PalayRecoveryTest
from ..models.reference import QualityGrade, RiceVariety
from ..models.supplier_customer import Supplier
from ..models.user import User
from .base import BaseRepository


class RiceVarietyRepository(BaseRepository[RiceVariety]):
    model = RiceVariety

    def list_company_or_shared(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[RiceVariety]:
        """Tenant varieties plus shared/system ones (company_id IS NULL)."""
        stmt = select(RiceVariety).where((RiceVariety.company_id == company_id) | (RiceVariety.company_id.is_(None)))
        if not include_inactive:
            stmt = stmt.where(RiceVariety.is_active.is_(True))
        return self.db.execute(stmt.order_by(RiceVariety.code)).scalars().all()

    def get_by_code(
        self, company_id: uuid.UUID, code: str, *, kind: str = "rice", exclude_id: uuid.UUID | None = None
    ) -> RiceVariety | None:
        """The variety with that code, ignoring case, among the company's own and
        the standard (shared) ones that share a list with ``kind``: a palay and a
        rice variety may have the same code, but not two on the same page."""
        kinds = ("palay", "rice", "both") if kind == "both" else (kind, "both")
        stmt = select(RiceVariety).where(
            (RiceVariety.company_id == company_id) | (RiceVariety.company_id.is_(None)),
            func.lower(RiceVariety.code) == code.lower(),
            RiceVariety.kind.in_(kinds),
        )
        if exclude_id is not None:
            stmt = stmt.where(RiceVariety.id != exclude_id)
        return self.db.execute(stmt).scalars().first()


class QualityGradeRepository(BaseRepository[QualityGrade]):
    model = QualityGrade

    def list_company_or_shared(self, company_id: uuid.UUID) -> Sequence[QualityGrade]:
        stmt = select(QualityGrade).where((QualityGrade.company_id == company_id) | (QualityGrade.company_id.is_(None)))
        return self.db.execute(stmt.order_by(QualityGrade.code)).scalars().all()

    def get_by_code(self, company_id: uuid.UUID, code: str) -> QualityGrade | None:
        stmt = select(QualityGrade).where(QualityGrade.company_id == company_id, QualityGrade.code == code)
        return self.db.execute(stmt).scalars().first()


class SupplierRepository(BaseRepository[Supplier]):
    model = Supplier

    def list_for_company(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[Supplier]:
        stmt = select(Supplier).where(Supplier.company_id == company_id)
        if not include_inactive:
            stmt = stmt.where(Supplier.is_active.is_(True))
        return self.db.execute(stmt.order_by(Supplier.name)).scalars().all()


class PalayPurchaseRepository(BaseRepository[PalayPurchase]):
    model = PalayPurchase

    def list_for_company(
        self, company_id: uuid.UUID, *, status: str | None = None, skip: int = 0, limit: int = 50
    ) -> Sequence[PalayPurchase]:
        # The list shows each purchase's supplier, item count and who recorded it:
        # load those with it rather than one query per row.
        stmt = (
            select(PalayPurchase)
            .options(
                joinedload(PalayPurchase.creator).joinedload(User.role),
                joinedload(PalayPurchase.supplier),
                selectinload(PalayPurchase.items),
                selectinload(PalayPurchase.recovery_tests).options(
                    joinedload(PalayRecoveryTest.variety), joinedload(PalayRecoveryTest.creator)
                ),
            )
            .where(PalayPurchase.company_id == company_id)
        )
        stmt = only_viewed(stmt, PalayPurchase.branch_id, self.db)
        if status:
            stmt = stmt.where(PalayPurchase.status == status)
        stmt = stmt.order_by(PalayPurchase.purchase_date.desc()).offset(skip).limit(limit)
        return self.db.execute(stmt).scalars().all()


class PalayInventoryRepository(BaseRepository[PalayInventory]):
    model = PalayInventory

    def list_with_stock(
        self, company_id: uuid.UUID, *, branch_id: uuid.UUID | None = None, warehouse_id: uuid.UUID | None = None
    ) -> Sequence[PalayInventory]:
        stmt = select(PalayInventory).where(PalayInventory.company_id == company_id, PalayInventory.quantity_kg > 0)
        branch_id = branch_id or viewed_branch(self.db)
        if branch_id:
            stmt = stmt.where(PalayInventory.branch_id == branch_id)
        if warehouse_id:
            stmt = stmt.where(PalayInventory.warehouse_id == warehouse_id)
        return self.db.execute(stmt).scalars().all()

    def find_bucket(
        self, company_id: uuid.UUID, branch_id, variety_id, grade_id, warehouse_id=None
    ) -> PalayInventory | None:
        """The single stock row for a (company, branch, warehouse, variety, grade)
        tuple; with no warehouse named, the first row of the branch's."""
        stmt = select(PalayInventory).where(
            PalayInventory.company_id == company_id,
            PalayInventory.branch_id == branch_id,
            PalayInventory.variety_id == variety_id,
            PalayInventory.grade_id == grade_id,
        )
        if warehouse_id is not None:
            stmt = stmt.where(PalayInventory.warehouse_id == warehouse_id)
        return self.db.execute(stmt).scalars().first()
