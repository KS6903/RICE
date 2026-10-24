"""BuyingService — rice (bigas) and by-product purchases.

The same shape as PaddyService's purchases: guard the client-supplied ids, pick
the warehouse (same rule as palay), then write the purchase, its lines and the
stock they add in one transaction. Rice lands on the milled-rice stock row for
its variety + grade in that warehouse, by-products on the row for their type —
the same rows milling output and Add inventory use.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.branch_scope import only_viewed
from ..models.buying import ByproductPurchase, ByproductPurchaseItem, RicePurchase, RicePurchaseItem
from ..models.milling import ByproductInventory, MilledRiceInventory
from ..models.reference import RiceVariety
from ..models.supplier_customer import Supplier
from ..repositories.inventory import ByproductInventoryRepository, MilledRiceInventoryRepository
from ..services.base import BaseService
from ..services.paddy_service import purchase_warehouse

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
        company_id = self.current_user.company_id
        with self.transaction():
            purchase = self._header(RicePurchase, "RP", data, branch_id)
            for line in data.items:
                item = RicePurchaseItem(purchase_id=purchase.id, **line.model_dump())
                self.db.add(item)
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
                stock.quantity_kg = (stock.quantity_kg or Decimal("0")) + item.weight_kg
                self.db.flush()
        self.db.refresh(purchase)
        return self.serialize(purchase)

    # ── by-products ───────────────────────────────────────────────────────────

    def list_byproduct_purchases(self, *, skip: int = 0, limit: int = 50) -> list[dict]:
        return [self.serialize(p) for p in self._list(ByproductPurchase, skip=skip, limit=limit)]

    def create_byproduct_purchase(self, data) -> dict:
        """Record a by-product purchase and add its weight to by-product stock — atomically."""
        self.assert_company_fk(Supplier, data.supplier_id, label="Supplier")
        branch_id = purchase_warehouse(self.db, self.current_user, data.branch_id)
        company_id = self.current_user.company_id
        with self.transaction():
            purchase = self._header(ByproductPurchase, "BP", data, branch_id)
            for line in data.items:
                item = ByproductPurchaseItem(purchase_id=purchase.id, **line.model_dump())
                self.db.add(item)
                stock = self.byproducts.find_bucket(company_id, branch_id, item.byproduct_type)
                if stock is None:
                    stock = ByproductInventory(
                        company_id=company_id,
                        branch_id=branch_id,
                        byproduct_type=item.byproduct_type,
                        quantity_kg=Decimal("0"),
                    )
                    self.db.add(stock)
                stock.quantity_kg = (stock.quantity_kg or Decimal("0")) + item.weight_kg
                self.db.flush()
        self.db.refresh(purchase)
        return self.serialize(purchase)
