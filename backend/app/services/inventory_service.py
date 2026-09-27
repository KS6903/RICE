"""InventoryService — business logic for the inventory domain (Phase 3a).

Reads (milled rice / by-products / summary) and writes (manual adjustment and
stock add, including the upsert-onto-matching-row behavior) move here off the
route handlers. Serialized shapes are preserved verbatim. The service owns the
transaction; repositories flush only.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError, ValidationError
from ..models.company import Branch
from ..models.milling import ByproductInventory, MilledRiceInventory
from ..models.paddy import PalayInventory
from ..models.reference import QualityGrade, RiceVariety
from ..repositories.inventory import (
    ByproductInventoryRepository,
    MilledRiceInventoryRepository,
)
from ..repositories.paddy import PalayInventoryRepository
from ..services.base import BaseService


class InventoryService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        milled: MilledRiceInventoryRepository,
        byproducts: ByproductInventoryRepository,
        palay: PalayInventoryRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.milled = milled
        self.byproducts = byproducts
        self.palay = palay

    # ── reads ─────────────────────────────────────────────────────────────────

    def _branch_map(self) -> dict:
        rows = self.db.query(Branch).filter(Branch.company_id == self.current_user.company_id).all()
        return {str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch} for b in rows}

    def get_milled_rice(self, *, branch_id: uuid.UUID | None = None) -> list[dict]:
        rows = self.milled.list_with_stock(self.current_user.company_id, branch_id=branch_id)
        branches = self._branch_map()
        return [
            {
                "id": str(r.id),
                "branch_id": str(r.branch_id) if r.branch_id else None,
                "branch": branches.get(str(r.branch_id)) if r.branch_id else None,
                "variety_id": str(r.variety_id) if r.variety_id else None,
                "variety": {"id": str(r.variety.id), "code": r.variety.code, "name": r.variety.name}
                if r.variety
                else None,
                "grade_name": r.grade_name,
                "quantity_kg": float(r.quantity_kg),
            }
            for r in rows
        ]

    def get_byproducts(self, *, branch_id: uuid.UUID | None = None) -> list[dict]:
        rows = self.byproducts.list_for_company(self.current_user.company_id, branch_id=branch_id)
        branches = self._branch_map()
        return [
            {
                "id": str(r.id),
                "branch_id": str(r.branch_id) if r.branch_id else None,
                "branch": branches.get(str(r.branch_id)) if r.branch_id else None,
                "byproduct_type": r.byproduct_type,
                "quantity_kg": float(r.quantity_kg),
            }
            for r in rows
        ]

    def get_summary(self, *, branch_id: uuid.UUID | None = None) -> dict:
        company_id = self.current_user.company_id
        palay = self.palay.list_for_company(company_id, branch_id=branch_id)
        milled = self.milled.list_for_company(company_id, branch_id=branch_id)
        byproducts = self.byproducts.list_for_company(company_id, branch_id=branch_id)

        branches = self._branch_map()
        by_branch: dict[str, dict] = {}

        def _bucket(branch_ref) -> dict:
            bid = str(branch_ref) if branch_ref else "_unassigned"
            return by_branch.setdefault(
                bid, {"branch": branches.get(bid), "palay_kg": 0.0, "milled_kg": 0.0, "byproduct_kg": 0.0}
            )

        for p in palay:
            _bucket(p.branch_id)["palay_kg"] += float(p.quantity_kg)
        for m in milled:
            _bucket(m.branch_id)["milled_kg"] += float(m.quantity_kg)
        for b in byproducts:
            _bucket(b.branch_id)["byproduct_kg"] += float(b.quantity_kg)

        return {
            "palay_total_kg": sum(float(i.quantity_kg) for i in palay),
            "milled_rice_total_kg": sum(float(i.quantity_kg) for i in milled),
            "byproducts": {b.byproduct_type: float(b.quantity_kg) for b in byproducts},
            "by_branch": list(by_branch.values()),
        }

    # ── writes ────────────────────────────────────────────────────────────────

    def adjust(self, data) -> dict:
        inv: Any
        if data.inventory_type == "palay":
            inv = self.palay.get(data.inventory_id)
        elif data.inventory_type == "milled_rice":
            inv = self.milled.get(data.inventory_id)
        else:
            inv = self.byproducts.get(data.inventory_id)

        with self.transaction():
            if inv:
                inv.quantity_kg = max(Decimal("0"), inv.quantity_kg + data.quantity_kg)
        if inv:
            self.db.refresh(inv)
        return {"adjusted": True, "new_quantity_kg": float(inv.quantity_kg) if inv else 0}

    def add_stock(self, data) -> dict:
        """Owner/admin manual stock add. Upserts onto a matching row so lists
        don't fill with duplicate entries (mirrors how milling output lands)."""
        if data.quantity_kg is None or data.quantity_kg <= 0:
            raise ValidationError("Quantity must be greater than zero.")

        if data.branch_id:
            branch = self.db.get(Branch, data.branch_id)
            if not branch or branch.company_id != self.current_user.company_id:
                raise NotFoundError("Warehouse not found.")
        # IDOR guards: varieties/grades must be ours or from the shared catalog
        # (a foreign id would otherwise leak that tenant's variety name via joins).
        self.assert_company_fk(RiceVariety, data.variety_id, label="Variety", allow_shared=True)
        self.assert_company_fk(QualityGrade, data.grade_id, label="Grade", allow_shared=True)

        company_id = self.current_user.company_id
        inv: Any = None

        with self.transaction():
            if data.inventory_type == "palay":
                if not data.variety_id:
                    raise ValidationError("Variety is required for palay.")
                inv = self.palay.find_bucket(company_id, data.branch_id, data.variety_id, data.grade_id)
                if not inv:
                    inv = PalayInventory(
                        company_id=company_id,
                        branch_id=data.branch_id,
                        variety_id=data.variety_id,
                        grade_id=data.grade_id,
                        quantity_kg=Decimal("0"),
                    )
                    self.db.add(inv)
                inv.quantity_kg = inv.quantity_kg + data.quantity_kg

            elif data.inventory_type == "milled_rice":
                if not data.variety_id:
                    raise ValidationError("Variety is required for milled rice.")
                inv = self.milled.find_bucket(company_id, data.branch_id, data.variety_id, data.grade_name)
                if not inv:
                    inv = MilledRiceInventory(
                        company_id=company_id,
                        branch_id=data.branch_id,
                        variety_id=data.variety_id,
                        grade_name=data.grade_name,
                        quantity_kg=Decimal("0"),
                    )
                    self.db.add(inv)
                inv.quantity_kg = inv.quantity_kg + data.quantity_kg

            elif data.inventory_type == "byproduct":
                # By-product type is a free-form slug so owners can introduce their
                # own named goods (and custom stock types route through here too).
                btype = (data.byproduct_type or "").strip().lower()
                if not btype:
                    raise ValidationError("By-product type is required.")
                data.byproduct_type = btype
                inv = self.byproducts.find_bucket(company_id, data.branch_id, btype)
                if not inv:
                    inv = ByproductInventory(
                        company_id=company_id,
                        branch_id=data.branch_id,
                        byproduct_type=btype,
                        quantity_kg=Decimal("0"),
                    )
                    self.db.add(inv)
                inv.quantity_kg = inv.quantity_kg + data.quantity_kg

            else:
                raise ValidationError("inventory_type must be one of: palay, milled_rice, byproduct.")

        self.db.refresh(inv)
        return {
            "id": str(inv.id),
            "inventory_type": data.inventory_type,
            "quantity_kg": float(inv.quantity_kg),
        }
