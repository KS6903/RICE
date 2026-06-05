"""PaddyService — business logic for the paddy domain (Phase 2.3).

This is the reference template every other domain copies. It:

* takes its repositories via the constructor (dependency injection),
* raises semantic exceptions (app.core.exceptions) instead of HTTPException,
* owns the transaction boundary via BaseService.transaction(), so the multi-item
  purchase + its inventory movements commit all-or-nothing.

The old module-level helpers (services/paddy.py: generate_reference_no,
update_palay_inventory) are folded in here as private methods.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ..core.exceptions import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from ..models.company import Branch
from ..models.paddy import (
    PalayInventory,
    PalayInventoryMovement,
    PalayPurchase,
    PalayPurchaseItem,
)
from ..models.reference import QualityGrade, RiceVariety
from ..models.supplier_customer import Supplier
from ..repositories.paddy import (
    PalayInventoryRepository,
    PalayPurchaseRepository,
    QualityGradeRepository,
    RiceVarietyRepository,
    SupplierRepository,
)
from ..services.base import BaseService
from ..services.canva_color import pick_unused_color


class PaddyService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        varieties: RiceVarietyRepository,
        grades: QualityGradeRepository,
        suppliers: SupplierRepository,
        purchases: PalayPurchaseRepository,
        inventory: PalayInventoryRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.varieties = varieties
        self.grades = grades
        self.suppliers = suppliers
        self.purchases = purchases
        self.inventory = inventory

    # ── varieties ─────────────────────────────────────────────────────────────

    def list_varieties(self, *, include_inactive: bool = False) -> Sequence[RiceVariety]:
        return self.varieties.list_company_or_shared(
            self.current_user.company_id, include_inactive=include_inactive
        )

    def create_variety(self, data) -> RiceVariety:
        if self.varieties.get_by_code(self.current_user.company_id, data.code):
            raise ConflictError(
                f"Variety code '{data.code}' already exists in your company", code="variety_exists"
            )
        variety = RiceVariety(company_id=self.current_user.company_id, **data.model_dump())
        with self.transaction():
            self.varieties.add(variety)
        self.db.refresh(variety)
        return variety

    def update_variety(self, variety_id: uuid.UUID, data) -> RiceVariety:
        v = self.varieties.get(variety_id)
        if not v:
            raise NotFoundError("Variety not found")
        if v.company_id != self.current_user.company_id:
            raise PermissionDeniedError(
                "Cannot edit shared/system varieties. Create your own copy instead."
            )
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(v, field, val)
        self.db.refresh(v)
        return v

    # ── grades ────────────────────────────────────────────────────────────────

    def list_grades(self) -> Sequence[QualityGrade]:
        return self.grades.list_company_or_shared(self.current_user.company_id)

    def create_grade(self, data) -> QualityGrade:
        code = data.code.strip()
        if not code:
            raise ValidationError("Grade code is required.")
        if self.grades.get_by_code(self.current_user.company_id, code):
            raise ConflictError(f"Grade '{code}' already exists in your company.", code="grade_exists")
        grade = QualityGrade(
            company_id=self.current_user.company_id,
            code=code,
            name=(data.name or code).strip(),
        )
        with self.transaction():
            self.grades.add(grade)
        self.db.refresh(grade)
        return grade

    # ── suppliers ─────────────────────────────────────────────────────────────

    def list_suppliers(self, *, include_inactive: bool = False) -> Sequence[Supplier]:
        return self.suppliers.list_for_company(
            self.current_user.company_id, include_inactive=include_inactive
        )

    def create_supplier(self, data) -> Supplier:
        # System-generated canva color from the shared per-tenant pool — never
        # accepted from the client.
        color = pick_unused_color(self.db, self.current_user.company_id)
        supplier = Supplier(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            canva_color_hex=color,
            **data.model_dump(),
        )
        with self.transaction():
            self.suppliers.add(supplier)
        self.db.refresh(supplier)
        return supplier

    def update_supplier(self, supplier_id: uuid.UUID, data) -> Supplier:
        s = self.suppliers.get_for_company(supplier_id, self.current_user.company_id)
        if not s:
            raise NotFoundError("Supplier not found")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(s, field, val)
        self.db.refresh(s)
        return s

    # ── purchases ─────────────────────────────────────────────────────────────

    def list_purchases(self, *, skip: int = 0, limit: int = 50, status: str | None = None) -> Sequence[PalayPurchase]:
        return self.purchases.list_for_company(
            self.current_user.company_id, status=status, skip=skip, limit=limit
        )

    def get_purchase(self, purchase_id: uuid.UUID) -> PalayPurchase:
        p = self.purchases.get_for_company(purchase_id, self.current_user.company_id)
        if not p:
            raise NotFoundError("Purchase not found")
        return p

    def create_purchase(self, data) -> PalayPurchase:
        """Create a purchase and roll its items into palay stock — atomically."""
        with self.transaction():
            purchase = self.purchases.add(
                PalayPurchase(
                    company_id=self.current_user.company_id,
                    branch_id=self.current_user.branch_id,
                    reference_no=self._next_reference_no(),
                    supplier_id=data.supplier_id,
                    purchase_date=data.purchase_date,
                    delivery_type=data.delivery_type,
                    remarks=data.remarks,
                    status="received",
                    created_by=self.current_user.id,
                )
            )
            for item_data in data.items:
                item = PalayPurchaseItem(purchase_id=purchase.id, **item_data.model_dump())
                item.cavan_count = (item.gross_weight_kg - item.tare_weight_kg) / 50
                self.db.add(item)
                self.db.flush()
                self._apply_inventory_movement(item, "in", str(purchase.id))
        self.db.refresh(purchase)
        return purchase

    def update_purchase(self, purchase_id: uuid.UUID, body: dict) -> PalayPurchase:
        p = self.purchases.get_for_company(purchase_id, self.current_user.company_id)
        if not p:
            raise NotFoundError("Purchase not found")
        with self.transaction():
            for field in ("status", "remarks", "delivery_type"):
                if field in body:
                    setattr(p, field, body[field])
        self.db.refresh(p)
        return p

    # ── inventory (read) ──────────────────────────────────────────────────────

    def get_palay_inventory(self, *, branch_id: uuid.UUID | None = None) -> list[dict]:
        """Serialized live palay stock. Shape preserved verbatim from the old route."""
        rows = self.inventory.list_with_stock(self.current_user.company_id, branch_id=branch_id)
        branch_rows = (
            self.db.query(Branch).filter(Branch.company_id == self.current_user.company_id).all()
        )
        bmap = {
            str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch}
            for b in branch_rows
        }
        return [
            {
                "id": str(r.id),
                "branch_id": str(r.branch_id) if r.branch_id else None,
                "branch": bmap.get(str(r.branch_id)) if r.branch_id else None,
                "variety": {"id": str(r.variety.id), "code": r.variety.code, "name": r.variety.name} if r.variety else None,
                "grade": {"id": str(r.grade.id), "code": r.grade.code} if r.grade else None,
                "quantity_kg": float(r.quantity_kg),
            }
            for r in rows
        ]

    # ── private helpers (formerly services/paddy.py) ──────────────────────────

    def _next_reference_no(self) -> str:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        count = self.db.query(PalayInventoryMovement).count() + 1
        return f"PP-{today}-{count:04d}"

    def _apply_inventory_movement(self, item: PalayPurchaseItem, direction: str, source_id: str) -> None:
        inv = self.inventory.find_bucket(
            self.current_user.company_id, self.current_user.branch_id, item.variety_id, item.grade_id
        )
        qty = item.net_weight_kg if direction == "in" else -item.net_weight_kg
        if not inv:
            inv = PalayInventory(
                company_id=self.current_user.company_id,
                branch_id=self.current_user.branch_id,
                variety_id=item.variety_id,
                grade_id=item.grade_id,
                quantity_kg=max(Decimal("0"), qty),
            )
            self.db.add(inv)
            self.db.flush()
        else:
            inv.quantity_kg = max(Decimal("0"), inv.quantity_kg + qty)

        self.db.add(
            PalayInventoryMovement(
                inventory_id=inv.id,
                movement_type="in" if direction == "in" else "out",
                source_type="purchase",
                source_id=uuid.UUID(source_id),
                quantity_kg=abs(qty),
                balance_after_kg=inv.quantity_kg,
                created_by=self.current_user.id,
                created_at=datetime.now(timezone.utc),
            )
        )
