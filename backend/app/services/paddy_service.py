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

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..core.exceptions import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from ..models.company import Branch, Company
from ..models.paddy import (
    KG_PER_CAVAN,
    DryingRecord,
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
from ..services.record_changes import changed_fields, log_changes, show


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
        return self.varieties.list_company_or_shared(self.current_user.company_id, include_inactive=include_inactive)

    def create_variety(self, data) -> RiceVariety:
        payload = data.model_dump()
        payload["code"] = self._free_variety_code(data.code, kind=data.kind)
        payload["name"] = _required(data.name, "Give the variety a name.")
        variety = RiceVariety(company_id=self.current_user.company_id, **payload)
        with self.transaction():
            self.varieties.add(variety)
        self.db.refresh(variety)
        return variety

    def update_variety(self, variety_id: uuid.UUID, data) -> RiceVariety:
        """Edit a variety, or hide it (is_active=False) from the pickers and
        unhide it. The standard ones (Dinorado and the rest) are this mill's
        own copy in its schema, so they can be edited and hidden too."""
        v = self.varieties.get(variety_id)
        if not v or v.company_id not in (self.current_user.company_id, None):
            raise NotFoundError("Variety not found")
        payload = data.model_dump(exclude_none=True)
        if "code" in payload:
            payload["code"] = self._free_variety_code(payload["code"], kind=v.kind, exclude_id=v.id)
        if "name" in payload:
            payload["name"] = _required(payload["name"], "Give the variety a name.")
        with self.transaction():
            for field, val in payload.items():
                setattr(v, field, val)
            if payload.get("is_active") is False and v.deactivated_at is None:
                v.deactivated_at = datetime.now(timezone.utc)
            elif payload.get("is_active") is True:
                v.deactivated_at = None
        self.db.refresh(v)
        return v

    def _free_variety_code(self, code: str, *, kind: str, exclude_id: uuid.UUID | None = None) -> str:
        code = _required(code, "Give the variety a code.")
        if self.varieties.get_by_code(self.current_user.company_id, code, kind=kind, exclude_id=exclude_id):
            raise ConflictError(f"Variety code '{code}' already exists in your company", code="variety_exists")
        return code

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
        return self.suppliers.list_for_company(self.current_user.company_id, include_inactive=include_inactive)

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
        return self.purchases.list_for_company(self.current_user.company_id, status=status, skip=skip, limit=limit)

    @staticmethod
    def serialize_purchase(p: PalayPurchase) -> dict:
        """The purchase's columns, plus its supplier, warehouse, its lines and what
        they come to, and who recorded it and in what role."""
        data = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        data["supplier"] = {"id": p.supplier.id, "name": p.supplier.name} if p.supplier else None
        data["branch"] = {"id": str(p.branch.id), "name": p.branch.name} if p.branch else None
        data["item_count"] = len(p.items)
        data["items"] = [
            {
                "id": i.id,
                "variety_id": i.variety_id,
                "variety_code": i.variety.code if i.variety else None,
                "grade_id": i.grade_id,
                "grade_code": i.grade.code if i.grade else None,
                "sack_count": i.sack_count,
                "cavan_count": i.cavan_count,
                "gross_weight_kg": i.gross_weight_kg,
                "tare_weight_kg": i.tare_weight_kg,
                "net_weight_kg": i.net_weight_kg,
                "moisture_content_pct": i.moisture_content_pct,
                "price_per_cavan": i.price_per_cavan,
                "is_wet": i.is_wet,
                "is_drying": i.is_drying,
                "dried_weight_kg": i.dried_weight_kg,
                "dried_moisture_pct": i.dried_moisture_pct,
                "dried_at": i.dried_at,
                "line_total": i.total_amount,
            }
            for i in p.items
        ]
        # What the list shows beside the purchase: red while any wet line is
        # still to dry, green once every line is dry.
        data["is_drying"] = any(i.is_drying for i in p.items)
        data["total_kg"] = float(sum((i.net_weight_kg for i in p.items), Decimal("0")))
        data["total_amount"] = float(sum((i.total_amount for i in p.items), Decimal("0")))
        creator = p.creator
        data["created_by_name"] = creator.full_name if creator else None
        data["created_by_role"] = creator.role.name if creator and creator.role else None
        return data

    def get_purchase(self, purchase_id: uuid.UUID) -> PalayPurchase:
        p = self.purchases.get_for_company(purchase_id, self.current_user.company_id)
        if not p:
            raise NotFoundError("Purchase not found")
        return p

    def create_purchase(self, data) -> PalayPurchase:
        """Create a purchase and roll its items into palay stock — atomically."""
        # IDOR guards: supplier must be ours; varieties/grades must be ours or
        # from the shared system catalog.
        self.assert_company_fk(Supplier, data.supplier_id, label="Supplier")
        for item_data in data.items:
            self.assert_company_fk(RiceVariety, item_data.variety_id, label="Variety", allow_shared=True)
            self.assert_company_fk(QualityGrade, item_data.grade_id, label="Grade", allow_shared=True)
        branch_id = self._purchase_warehouse(data.branch_id)
        with self.transaction():
            purchase = self.purchases.add(
                PalayPurchase(
                    company_id=self.current_user.company_id,
                    branch_id=branch_id,
                    reference_no=self._next_reference_no(),
                    supplier_id=data.supplier_id,
                    purchase_date=data.purchase_date,
                    delivery_type=data.delivery_type,
                    remarks=data.remarks,
                    status="received",
                    created_by=self.current_user.id,
                )
            )
            lines = [self._add_line(purchase, item_data, branch_id) for item_data in data.items]
            _settle_status(purchase, lines)
        self.db.refresh(purchase)
        return purchase

    def edit_purchase(self, purchase_id: uuid.UUID, data) -> PalayPurchase:
        """Correct a saved purchase (edit power). Lines sent replace the old
        ones: the old lines' palay leaves the purchase's warehouse and the new
        ones' comes in. Every changed field is logged."""
        p = self.get_purchase(purchase_id)
        fields = data.model_dump(exclude_unset=True, exclude={"items"})
        if "purchase_date" in fields and fields["purchase_date"] is None:
            raise ValidationError("Give the purchase a date.")
        self.assert_company_fk(Supplier, fields.get("supplier_id"), label="Supplier")
        for item_data in data.items or []:
            self.assert_company_fk(RiceVariety, item_data.variety_id, label="Variety", allow_shared=True)
            self.assert_company_fk(QualityGrade, item_data.grade_id, label="Grade", allow_shared=True)
        before = _purchase_state(p)
        with self.transaction():
            for field, val in fields.items():
                setattr(p, field, val)
            if data.items is not None:
                # A drying record points at its line, so it goes before the line does.
                self.db.query(DryingRecord).filter(
                    DryingRecord.purchase_item_id.in_([old.id for old in p.items])
                ).delete(synchronize_session=False)
                for old in list(p.items):
                    self._apply_inventory_movement(old, "out", str(p.id), p.branch_id)
                    p.items.remove(old)
                self.db.flush()
                lines = [self._add_line(p, item_data, p.branch_id) for item_data in data.items]
                _settle_status(p, lines)
            self.db.flush()
            self.db.expire(p)
            log_changes(
                self.db,
                user=self.current_user,
                action="palay_purchase.edit",
                entity_type="palay_purchase",
                entity_id=p.id,
                entity_label=p.reference_no,
                lines=changed_fields(before, _purchase_state(p), PURCHASE_FIELDS),
            )
        self.db.refresh(p)
        return p

    def record_drying(self, purchase_id: uuid.UUID, item_id: uuid.UUID, data) -> PalayPurchase:
        """A wet line is dry: record what it weighs now and its moisture. Its stock
        becomes the dried weight, the line is complete, and the purchase is too
        once none of its lines is still wet."""
        p = self.get_purchase(purchase_id)
        item = next((i for i in p.items if i.id == item_id), None)
        if item is None:
            raise NotFoundError("Purchase line not found")
        if not item.is_wet:
            raise ValidationError("This line was bought dry.")
        if item.dried_weight_kg is not None:
            raise ConflictError(
                "This line's drying result is already recorded. Correct it with Edit.", code="already_dried"
            )
        wet_kg = item.stock_weight_kg
        before = item.moisture_content_pct
        with self.transaction():
            item.dried_weight_kg = data.dried_weight_kg
            item.dried_moisture_pct = data.dried_moisture_pct
            item.dried_at = datetime.now(timezone.utc)
            self._apply_inventory_change(
                item,
                data.dried_weight_kg - wet_kg,
                "adjustment",
                p.branch_id,
                source_id=p.id,
                notes=f"Dried: {show(wet_kg)} kg to {show(data.dried_weight_kg)} kg",
            )
            self._close_drying_record(item, p)
            _settle_status(p, list(p.items))
            log_changes(
                self.db,
                user=self.current_user,
                action="palay_purchase.dried",
                entity_type="palay_purchase",
                entity_id=p.id,
                entity_label=p.reference_no,
                lines=[
                    f"{_what(item)} dried: {show(wet_kg)} kg → {show(data.dried_weight_kg)} kg, "
                    f"moisture {show(before)}% → {show(data.dried_moisture_pct)}%"
                ],
            )
        self.db.refresh(p)
        return p

    def update_purchase(self, purchase_id: uuid.UUID, body) -> PalayPurchase:
        p = self.purchases.get_for_company(purchase_id, self.current_user.company_id)
        if not p:
            raise NotFoundError("Purchase not found")
        with self.transaction():
            # Typed PurchaseUpdate schema: only validated, allowlisted fields
            # arrive here; exclude_unset keeps "only touch sent fields" semantics.
            for field, val in body.model_dump(exclude_unset=True).items():
                setattr(p, field, val)
        self.db.refresh(p)
        return p

    # ── inventory (read) ──────────────────────────────────────────────────────

    def get_palay_inventory(self, *, branch_id: uuid.UUID | None = None) -> list[dict]:
        """Serialized live palay stock, each line in kilos, cavans and sacks, and how
        much of it is still wet.

        Stock is kept in kilos. A line's sacks are the kilos over what a sack of
        that palay weighed when it was bought (the sacks counted on its purchases),
        or over 50 kg when no purchase counted any; its cavans are the kilos over 50."""
        rows = self.inventory.list_with_stock(self.current_user.company_id, branch_id=branch_id)
        branch_rows = self.db.query(Branch).filter(Branch.company_id == self.current_user.company_id).all()
        bmap = {str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch} for b in branch_rows}
        bought = self._bought_by_bucket()
        out: list[dict] = []
        for r in rows:
            kg = float(r.quantity_kg)
            counted_kg, counted_sacks, wet_kg = bought.get((r.branch_id, r.variety_id, r.grade_id), (0.0, 0.0, 0.0))
            kg_per_sack = counted_kg / counted_sacks if counted_sacks > 0 and counted_kg > 0 else float(KG_PER_CAVAN)
            wet_kg = min(wet_kg, kg)
            out.append(
                {
                    "id": str(r.id),
                    "branch_id": str(r.branch_id) if r.branch_id else None,
                    "branch": bmap.get(str(r.branch_id)) if r.branch_id else None,
                    "variety": {"id": str(r.variety.id), "code": r.variety.code, "name": r.variety.name}
                    if r.variety
                    else None,
                    "grade": {"id": str(r.grade.id), "code": r.grade.code} if r.grade else None,
                    "quantity_kg": kg,
                    "quantity_cavans": round(kg / float(KG_PER_CAVAN), 2),
                    "quantity_sacks": round(kg / kg_per_sack, 2),
                    "wet_kg": round(wet_kg, 2),
                    "wet_cavans": round(wet_kg / float(KG_PER_CAVAN), 2),
                    "wet_sacks": round(wet_kg / kg_per_sack, 2),
                }
            )
        return out

    def _bought_by_bucket(self) -> dict[tuple, tuple[float, float, float]]:
        """Per (warehouse, variety, grade): the kilos and the sacks of the purchase
        lines that counted sacks, and the kilos still wet."""
        net = PalayPurchaseItem.gross_weight_kg - PalayPurchaseItem.tare_weight_kg
        held = func.coalesce(PalayPurchaseItem.dried_weight_kg, net)
        counted = PalayPurchaseItem.sack_count > 0
        wet = PalayPurchaseItem.is_wet.is_(True) & PalayPurchaseItem.dried_weight_kg.is_(None)
        rows = (
            self.db.query(
                PalayPurchase.branch_id,
                PalayPurchaseItem.variety_id,
                PalayPurchaseItem.grade_id,
                func.coalesce(func.sum(case((counted, held), else_=0)), 0),
                func.coalesce(func.sum(case((counted, PalayPurchaseItem.sack_count), else_=0)), 0),
                func.coalesce(func.sum(case((wet, net), else_=0)), 0),
            )
            .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
            .filter(PalayPurchase.company_id == self.current_user.company_id, PalayPurchase.status != "cancelled")
            .group_by(PalayPurchase.branch_id, PalayPurchaseItem.variety_id, PalayPurchaseItem.grade_id)
            .all()
        )
        return {(b, v, g): (float(kg), float(sacks), float(w)) for b, v, g, kg, sacks, w in rows}

    # ── how the stock is counted (the Boss's choice) ──────────────────────────

    def get_stock_view(self) -> str:
        company = self.db.get(Company, self.current_user.company_id)
        return (company.palay_stock_view if company else None) or "all"

    def set_stock_view(self, view: str) -> str:
        company = self.db.get(Company, self.current_user.company_id)
        if company is None:
            raise NotFoundError("Company not found")
        with self.transaction():
            company.palay_stock_view = view
        return view

    # ── private helpers (formerly services/paddy.py) ──────────────────────────

    def _next_reference_no(self) -> str:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        count = self.db.query(PalayInventoryMovement).count() + 1
        return f"PP-{today}-{count:04d}"

    def _purchase_warehouse(self, branch_id: uuid.UUID | None) -> uuid.UUID | None:
        return purchase_warehouse(self.db, self.current_user, branch_id)

    def _add_line(self, purchase: PalayPurchase, d, branch_id: uuid.UUID | None) -> PalayPurchaseItem:
        """Save one line of a purchase, put it in stock, and file its drying when
        it came with the after-drying weight."""
        values = d.model_dump()
        if values["gross_weight_kg"] is None:
            # Not weighed: a cavan is 50 kg, and so is a sack taken as 1 cavan.
            values["gross_weight_kg"] = (values["cavan_count"] or values["sack_count"]) * KG_PER_CAVAN
            values["tare_weight_kg"] = Decimal("0")
        item = PalayPurchaseItem(purchase_id=purchase.id, **values)
        if item.cavan_count is None:
            item.cavan_count = item.net_weight_kg / KG_PER_CAVAN
        if item.dried_weight_kg is not None:
            item.dried_at = datetime.now(timezone.utc)
        self.db.add(item)
        self.db.flush()
        self._apply_inventory_movement(item, "in", str(purchase.id), branch_id)
        if item.dried_weight_kg is not None:
            self._close_drying_record(item, purchase)
        return item

    def _close_drying_record(self, item: PalayPurchaseItem, purchase: PalayPurchase) -> None:
        """Note the drying as done, so the automations that watch for wet palay
        not yet drying leave it alone."""
        now = datetime.now(timezone.utc)
        self.db.add(
            DryingRecord(
                purchase_item_id=item.id,
                start_datetime=purchase.created_at or now,
                end_datetime=item.dried_at or now,
                initial_moisture_pct=item.moisture_content_pct,
                final_moisture_pct=item.dried_moisture_pct,
                drying_cost=0,
                operator_id=self.current_user.id,
            )
        )

    def _apply_inventory_movement(
        self, item: PalayPurchaseItem, direction: str, source_id: str, branch_id: uuid.UUID | None
    ) -> None:
        weight = item.stock_weight_kg
        self._apply_inventory_change(
            item,
            weight if direction == "in" else -weight,
            direction,
            branch_id,
            source_id=uuid.UUID(source_id),
        )

    def _apply_inventory_change(
        self,
        item: PalayPurchaseItem,
        qty: Decimal,
        movement_type: str,
        branch_id: uuid.UUID | None,
        *,
        source_id: uuid.UUID,
        notes: str | None = None,
    ) -> None:
        """Move the line's stock bucket by ``qty`` kg (never below zero) and log it."""
        inv = self.inventory.find_bucket(self.current_user.company_id, branch_id, item.variety_id, item.grade_id)
        if not inv:
            inv = PalayInventory(
                company_id=self.current_user.company_id,
                branch_id=branch_id,
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
                movement_type=movement_type,
                source_type="purchase",
                source_id=source_id,
                # An adjustment keeps its sign (drying only ever takes weight off).
                quantity_kg=qty if movement_type == "adjustment" else abs(qty),
                balance_after_kg=inv.quantity_kg,
                notes=notes,
                created_by=self.current_user.id,
                created_at=datetime.now(timezone.utc),
            )
        )


# ── module-level helpers ──────────────────────────────────────────────────────

# What an edit logs of a purchase (palay, rice or by-products), old to new.
PURCHASE_FIELDS = {
    "supplier": "Supplier",
    "purchase_date": "Date",
    "delivery_type": "Delivery",
    "remarks": "Remarks",
    "items": "Lines",
}


def purchase_state(p: Any, line_text: Any) -> dict[str, Any]:
    """A purchase as its edit log compares it: the header, and its lines in
    words, one string."""
    return {
        "supplier": p.supplier.name if p.supplier else None,
        "purchase_date": p.purchase_date,
        "delivery_type": p.delivery_type,
        "remarks": p.remarks,
        # Sorted: lines come back from the database in no set order.
        "items": "; ".join(sorted(line_text(i) for i in p.items)),
    }


def _what(i: PalayPurchaseItem) -> str:
    """A line in a few words: its variety and grade, and the sacks when counted."""
    what = " ".join(filter(None, [i.variety.code if i.variety else "Any variety", i.grade.code if i.grade else None]))
    return f"{what}, {show(i.sack_count)} sacks" if i.sack_count is not None else what


def _palay_line(i: PalayPurchaseItem) -> str:
    what = " ".join(filter(None, [i.variety.code if i.variety else "Any variety", i.grade.code if i.grade else None]))
    parts = []
    if i.sack_count is not None:
        parts.append(f"{show(i.sack_count)} sacks")
    parts += [f"{show(i.gross_weight_kg)} kg gross", f"{show(i.tare_weight_kg)} kg tare"]
    if i.moisture_content_pct is not None:
        parts.append(f"{show(i.moisture_content_pct)}% moisture")
    if i.is_wet:
        if i.dried_weight_kg is None:
            parts.append("wet")
        else:
            parts.append(f"wet, dried to {show(i.dried_weight_kg)} kg at {show(i.dried_moisture_pct)}%")
    parts.append(f"₱{show(i.price_per_cavan)}/cavan")
    return f"{what}, {', '.join(parts)}"


def _settle_status(purchase: PalayPurchase, lines: list[PalayPurchaseItem]) -> None:
    """A purchase is received while any of its lines is wet and undried, and
    completed once every line is dry. (A draft or cancelled one stays as it is.)"""
    if purchase.status in ("received", "completed"):
        purchase.status = "received" if any(i.is_drying for i in lines) else "completed"


def _purchase_state(p: PalayPurchase) -> dict[str, Any]:
    return purchase_state(p, _palay_line)


def purchase_warehouse(db: Session, current_user: Any, branch_id: uuid.UUID | None) -> uuid.UUID | None:
    """The warehouse a purchase (palay, rice or by-products) goes into: the
    recorder's own unless an owner or admin picked another of the company's live
    warehouses."""
    own = current_user.branch_id
    if branch_id is None or branch_id == own:
        return own
    role = getattr(getattr(current_user, "role", None), "name", None)
    if role not in ("owner", "admin") and not getattr(current_user, "is_platform_admin", False):
        raise PermissionDeniedError("Only an owner or admin can store a purchase in another warehouse.")
    branch = db.get(Branch, branch_id)
    # Another company's warehouse reads as missing, never as forbidden; a
    # warehouse in the trash takes no new stock.
    if not branch or branch.company_id != current_user.company_id or branch.deleted_at is not None:
        raise NotFoundError("Warehouse not found.")
    return branch.id


def _required(value: str, message: str) -> str:
    value = value.strip()
    if not value:
        raise ValidationError(message)
    return value
