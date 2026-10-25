"""BuyingService — rice (bigas) and by-product purchases.

The same shape as PaddyService's purchases: guard the client-supplied ids, pick
the warehouse (same rule as palay), then write the purchase, its lines and the
stock they add in one transaction. Rice lands on the milled-rice stock row for
its variety + grade in that warehouse, by-products on the row for their type —
the same rows milling output and Add inventory use.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.branch_scope import only_viewed
from ..core.exceptions import NotFoundError, ValidationError
from ..models.buying import ByproductPurchase, ByproductPurchaseItem, RicePurchase, RicePurchaseItem
from ..models.milling import ByproductInventory, MilledRiceInventory
from ..models.reference import RiceVariety
from ..models.supplier_customer import Supplier
from ..repositories.inventory import ByproductInventoryRepository, MilledRiceInventoryRepository
from ..services.base import BaseService
from ..services.byproduct_kind_service import ByproductKindService, byproduct_name
from ..services.paddy_service import PURCHASE_FIELDS, purchase_state, purchase_warehouse
from ..services.record_changes import changed_fields, log_changes, show

Purchase = RicePurchase | ByproductPurchase


class BuyingService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        milled: MilledRiceInventoryRepository,
        byproducts: ByproductInventoryRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.milled = milled
        self.byproducts = byproducts

    # ── shared ────────────────────────────────────────────────────────────────

    def _list(self, model: type[Purchase], *, skip: int, limit: int) -> list[Any]:
        return (
            only_viewed(
                self.db.query(model).filter(model.company_id == self.current_user.company_id),
                model.branch_id,
                self.db,
            )
            .order_by(model.purchase_date.desc(), model.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def serialize(self, p: Purchase) -> dict:
        """The purchase's columns, plus its supplier, warehouse, how many lines it
        has, and who recorded it and in what role (as the palay list has)."""
        data = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        data["supplier"] = {"id": p.supplier.id, "name": p.supplier.name} if p.supplier else None
        data["branch"] = {"id": str(p.branch.id), "name": p.branch.name} if p.branch else None
        data["item_count"] = len(p.items)
        data["items"] = [self._line(i) for i in p.items]
        data["total_kg"] = float(sum((i.weight_kg for i in p.items), Decimal("0")))
        data["total_amount"] = float(sum((i.total_amount for i in p.items), Decimal("0")))
        creator = p.creator
        data["created_by_name"] = creator.full_name if creator else None
        data["created_by_role"] = creator.role.name if creator and creator.role else None
        return data

    @staticmethod
    def _line(i: RicePurchaseItem | ByproductPurchaseItem) -> dict:
        """One purchase line, for the detail popup."""
        if isinstance(i, RicePurchaseItem):
            return {
                "id": i.id,
                "variety_id": i.variety_id,
                "variety_code": i.variety.code if i.variety else None,
                "grade_name": i.grade_name,
                "sack_count": i.sack_count,
                "kg_per_sack": i.kg_per_sack,
                "weight_kg": i.weight_kg,
                "price_per_sack": i.price_per_sack,
                "line_total": i.total_amount,
            }
        return {
            "id": i.id,
            "byproduct_type": i.byproduct_type,
            "weight_kg": i.weight_kg,
            "price_per_kg": i.price_per_kg,
            "line_total": i.total_amount,
        }

    def _reference_no(self, model: type[Purchase], prefix: str) -> str:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"{prefix}-{today}-{self.db.query(model).count() + 1:04d}"

    def _header(self, model: type[Purchase], prefix: str, data, branch_id) -> Any:
        purchase = model(
            company_id=self.current_user.company_id,
            branch_id=branch_id,
            reference_no=self._reference_no(model, prefix),
            supplier_id=data.supplier_id,
            purchase_date=data.purchase_date,
            delivery_type=data.delivery_type,
            remarks=data.remarks,
            status="received",
            created_by=self.current_user.id,
        )
        self.db.add(purchase)
        self.db.flush()
        return purchase

    # ── rice ──────────────────────────────────────────────────────────────────

    def list_rice_purchases(self, *, skip: int = 0, limit: int = 50) -> list[dict]:
        return [self.serialize(p) for p in self._list(RicePurchase, skip=skip, limit=limit)]

    def create_rice_purchase(self, data) -> dict:
        """Record a rice purchase and add its sacks to milled-rice stock — atomically."""
        self.assert_company_fk(Supplier, data.supplier_id, label="Supplier")
        for line in data.items:
            self.assert_company_fk(RiceVariety, line.variety_id, label="Variety", allow_shared=True)
        branch_id = purchase_warehouse(self.db, self.current_user, data.branch_id)
        with self.transaction():
            purchase = self._header(RicePurchase, "RP", data, branch_id)
            for line in data.items:
                item = RicePurchaseItem(purchase_id=purchase.id, **line.model_dump())
                self.db.add(item)
                self._move_rice(item, branch_id, 1)
        self.db.refresh(purchase)
        return self.serialize(purchase)

    def edit_rice_purchase(self, purchase_id: uuid.UUID, data) -> dict:
        """Correct a saved rice purchase (edit power); lines sent replace the old
        ones, and milled-rice stock follows. Every changed field is logged."""
        p = self._own(RicePurchase, purchase_id)
        for line in data.items or []:
            self.assert_company_fk(RiceVariety, line.variety_id, label="Variety", allow_shared=True)
        return self._edit(p, data, RicePurchaseItem, self._move_rice, _rice_line, "rice_purchase")

    def _move_rice(self, item: RicePurchaseItem, branch_id: uuid.UUID | None, sign: int) -> None:
        """Put a rice line's kilos into milled-rice stock (sign 1), or take them out (-1)."""
        company_id = self.current_user.company_id
        stock = self.milled.find_bucket(company_id, branch_id, item.variety_id, item.grade_name)
        if stock is None:
            stock = MilledRiceInventory(
                company_id=company_id,
                branch_id=branch_id,
                variety_id=item.variety_id,
                grade_name=item.grade_name,
                quantity_kg=Decimal("0"),
            )
            self.db.add(stock)
        stock.quantity_kg = (stock.quantity_kg or Decimal("0")) + sign * item.weight_kg
        self.db.flush()

    # ── by-products ───────────────────────────────────────────────────────────

    def list_byproduct_purchases(self, *, skip: int = 0, limit: int = 50) -> list[dict]:
        return [self.serialize(p) for p in self._list(ByproductPurchase, skip=skip, limit=limit)]

    def create_byproduct_purchase(self, data) -> dict:
        """Record a by-product purchase and add its weight to by-product stock — atomically."""
        self.assert_company_fk(Supplier, data.supplier_id, label="Supplier")
        branch_id = purchase_warehouse(self.db, self.current_user, data.branch_id)
        with self.transaction():
            purchase = self._header(ByproductPurchase, "BP", data, branch_id)
            for line in data.items:
                item = ByproductPurchaseItem(purchase_id=purchase.id, **line.model_dump())
                self.db.add(item)
                self._move_byproduct(item, branch_id, 1)
        self.db.refresh(purchase)
        return self.serialize(purchase)

    def edit_byproduct_purchase(self, purchase_id: uuid.UUID, data) -> dict:
        """Correct a saved by-product purchase (edit power); lines sent replace
        the old ones, and by-product stock follows. Every changed field is logged."""
        p = self._own(ByproductPurchase, purchase_id)
        return self._edit(p, data, ByproductPurchaseItem, self._move_byproduct, _byproduct_line, "byproduct_purchase")

    def _move_byproduct(self, item: ByproductPurchaseItem, branch_id: uuid.UUID | None, sign: int) -> None:
        """Put a by-product line's kilos into stock (sign 1), or take them out
        (-1). A by-product new to the mill joins its list."""
        company_id = self.current_user.company_id
        if sign > 0:
            ByproductKindService(self.db, self.current_user).ensure(item.byproduct_type)
        stock = self.byproducts.find_bucket(company_id, branch_id, item.byproduct_type)
        if stock is None:
            stock = ByproductInventory(
                company_id=company_id,
                branch_id=branch_id,
                byproduct_type=item.byproduct_type,
                quantity_kg=Decimal("0"),
            )
            self.db.add(stock)
        stock.quantity_kg = (stock.quantity_kg or Decimal("0")) + sign * item.weight_kg
        self.db.flush()

    # ── corrections ───────────────────────────────────────────────────────────

    def _own(self, model: type[Purchase], purchase_id: uuid.UUID) -> Any:
        p: Any = self.db.get(model, purchase_id)
        if p is None or p.company_id != self.current_user.company_id:
            raise NotFoundError("Purchase not found")
        return p

    def _edit(self, p: Any, data, item_model: type, move: Callable, line_text: Callable, entity_type: str) -> dict:
        """The correction both kinds share: the header fields sent, and, when
        lines are sent, the old lines' stock out and the new lines' in, in the
        purchase's warehouse; then one log row of every changed field."""
        fields = data.model_dump(exclude_unset=True, exclude={"items"})
        if "purchase_date" in fields and fields["purchase_date"] is None:
            raise ValidationError("Give the purchase a date.")
        self.assert_company_fk(Supplier, fields.get("supplier_id"), label="Supplier")
        before = purchase_state(p, line_text)
        with self.transaction():
            for field, val in fields.items():
                setattr(p, field, val)
            if data.items is not None:
                for old in list(p.items):
                    move(old, p.branch_id, -1)
                    p.items.remove(old)
                for line in data.items:
                    item = item_model(purchase_id=p.id, **line.model_dump())
                    self.db.add(item)
                    move(item, p.branch_id, 1)
            self.db.flush()
            self.db.expire(p)
            log_changes(
                self.db,
                user=self.current_user,
                action=f"{entity_type}.edit",
                entity_type=entity_type,
                entity_id=p.id,
                entity_label=p.reference_no,
                lines=changed_fields(before, purchase_state(p, line_text), PURCHASE_FIELDS),
            )
        self.db.refresh(p)
        return self.serialize(p)


def _rice_line(i: RicePurchaseItem) -> str:
    what = " ".join(filter(None, [i.variety.code if i.variety else "Any variety", i.grade_name]))
    return f"{what}, {show(i.sack_count)} sacks of {show(i.kg_per_sack)} kg at ₱{show(i.price_per_sack)}/sack"


def _byproduct_line(i: ByproductPurchaseItem) -> str:
    return f"{byproduct_name(i.byproduct_type)}, {show(i.weight_kg)} kg at ₱{show(i.price_per_kg)}/kg"
