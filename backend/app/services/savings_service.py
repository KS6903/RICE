"""SavingsService: the Savings page, where a mill sees what's leaking money and stops
it. It reads what the other pages record and adds what they don't: holds, readings
and vale. The sums are in savings_formulas; the page's figures are the Boss's alone,
as the Profit calculator's are.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from ..core.branch_scope import viewed_branch
from ..core.exceptions import ConflictError, NotFoundError, ValidationError
from ..core.security import get_user_features
from ..core.timezones import local_today
from ..models.company import Company
from ..models.milling import (
    ByproductInventory,
    MillingBatch,
    MillingBatchInput,
    MillingEquipment,
    MillingInputLot,
    StockMovement,
)
from ..models.paddy import KG_PER_CAVAN, PalayPurchase, PalayPurchaseItem
from ..models.supplier_customer import AdvanceSettlement, Customer, Supplier, SupplierAdvance
from ..models.warehouse import Pallet, RiceBatch, StockHold, WarehouseLayout, WarehouseZone, ZoneReading
from . import pallet_flow
from .base import BaseService
from .profit_service import BYPRODUCTS, ProfitService, price_plan
from .record_changes import log_changes
from .savings_formulas import (
    DEFAULT_SETTINGS,
    batch_alerts,
    landed_price,
    mass_balance,
    max_palay_price,
    settings_for,
    unsold_since,
    utilization_band,
)

# Auto-imported pallets were given a date when the floor plan was first made.
ASSUMED_DATE_CLIENT = "Mill stock (auto-imported)"
LOOKBACK_DAYS = 90


def apply_advances(db: Session, purchase: PalayPurchase, wanted: Decimal | None) -> None:
    """Take a farmer's open vale off a purchase, oldest first: ``wanted`` pesos, or as
    much as the purchase can carry when None. Replaces what it took before, so a
    corrected purchase settles afresh. Doesn't commit."""
    db.query(AdvanceSettlement).filter(AdvanceSettlement.purchase_id == purchase.id).delete(synchronize_session=False)
    db.flush()
    if purchase.supplier_id is None:
        return
    total = sum((Decimal(i.total_amount) for i in purchase.items), Decimal(0))
    left = min(total, wanted) if wanted is not None else total
    advances = (
        db.query(SupplierAdvance)
        .options(selectinload(SupplierAdvance.settlements))
        .filter(
            SupplierAdvance.company_id == purchase.company_id,
            SupplierAdvance.supplier_id == purchase.supplier_id,
            SupplierAdvance.is_void.is_(False),
        )
        .order_by(SupplierAdvance.advance_date, SupplierAdvance.created_at)
        .populate_existing()
        .all()
    )
    for advance in advances:
        if left <= 0:
            break
        owed = Decimal(advance.amount) - sum((Decimal(s.amount) for s in advance.settlements), Decimal(0))
        take = min(owed, left)
        if take <= 0:
            continue
        db.add(AdvanceSettlement(advance_id=advance.id, purchase_id=purchase.id, amount=take.quantize(Decimal("0.01"))))
        left -= take
    db.flush()


def advance_deducted(db: Session, purchase_id: uuid.UUID) -> Decimal:
    return Decimal(
        db.query(func.sum(AdvanceSettlement.amount)).filter(AdvanceSettlement.purchase_id == purchase_id).scalar() or 0
    )


def price_floor(db: Session, user: Any) -> dict[uuid.UUID | None, float]:
    """The lowest price per kg that covers each rice variety's cost, packaging included;
    the None key is the mill's average, for a rice no batch has made yet. Empty on a
    plan without the Profit calculator, or with nothing to work it from."""
    if "profit" not in get_user_features(user, db):
        return {}
    svc = ProfitService(db, user)
    settings = svc.get_settings()
    extra = settings_for(db.get(Company, user.company_id))
    packaging = float(extra["packaging_per_sack"]) / max(float(extra["kg_per_sack"]), 1.0)
    data = svc._gather()
    floors: dict[uuid.UUID | None, float] = {}
    evens: list[float] = []
    for v in svc._palay_varieties():
        d = svc._variety_defaults(v, data)
        if d["palay_price"] is None:
            continue
        plan = price_plan(
            palay_kg=d["palay_kg"],
            palay_price=d["palay_price"],
            moisture_pct=d["moisture_pct"],
            recovery_pct=d["recovery_pct"],
            other_costs=d["palay_kg"] * d["other_cost_per_kg"],
            byproducts=[(d[f"{k}_pct"], d[f"{k}_price"] or 0.0) for k in BYPRODUCTS],
            target_margin_pct=settings["target_margin_pct"],
            market_price=d["market_price"],
        )
        if plan is None:
            continue
        even = plan["break_even"] + packaging
        evens.append(even)
        made = data["yields"].get(v.id) or {}
        for rice in {v.id, *made.get("rice_varieties", ())}:
            floors[rice] = max(floors.get(rice, 0.0), even)
    if evens:
        floors[None] = sum(evens) / len(evens)
    return floors


class SavingsService(BaseService):
    @property
    def _company_id(self) -> uuid.UUID:
        return self.current_user.company_id

    @property
    def _company(self) -> Company:
        company = self.db.get(Company, self._company_id)
        if company is None:
            raise NotFoundError("Company not found")
        return company

    def _today(self) -> date:
        return local_today(getattr(self._company, "timezone", None))

    def _viewed(self, model: Any) -> list:
        branch = viewed_branch(self.db)
        return [model.branch_id == branch] if branch is not None else []

    # ── settings ──────────────────────────────────────────────────────────────

    def get_settings(self) -> dict:
        return settings_for(self._company)

    def set_settings(self, changes: dict) -> dict:
        company = self._company
        unknown = set(changes) - set(DEFAULT_SETTINGS)
        if unknown:
            raise ValidationError(f"Unknown settings: {', '.join(sorted(unknown))}")
        with self.transaction():
            # A new dict: SQLAlchemy doesn't see a JSONB value changed in place.
            company.savings_settings = {**(company.savings_settings or {}), **changes}
        return self.get_settings()

    # ── the first tab: everything at a glance ─────────────────────────────────

    def overview(self) -> dict:
        since = self._today() - timedelta(days=LOOKBACK_DAYS)
        items = (
            self.db.query(PalayPurchaseItem)
            .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
            .filter(
                PalayPurchase.company_id == self._company_id,
                PalayPurchase.purchase_date >= since,
                PalayPurchase.status != "cancelled",
                PalayPurchaseItem.payable_weight_kg.isnot(None),
                *self._viewed(PalayPurchase),
            )
            .all()
        )
        deducted_kg = sum(float(i.net_weight_kg - i.paid_weight_kg) for i in items)
        deducted_php = sum(
            float((i.net_weight_kg - i.paid_weight_kg) / KG_PER_CAVAN * i.price_per_cavan) for i in items
        )
        batches = self.batches(limit=50)
        capacity = self.capacity()
        held = (
            self.db.query(func.sum(StockHold.weight_kg))
            .filter(StockHold.company_id == self._company_id, StockHold.cleared_at.is_(None), *self._viewed(StockHold))
            .scalar()
        )
        vale = self.advances()
        return {
            "lookback_days": LOOKBACK_DAYS,
            "deducted_kg": deducted_kg,
            "deducted_php": deducted_php,
            "batches_flagged": sum(1 for b in batches if b["alerts"]),
            "batches_checked": len(batches),
            "unaccounted_kg": sum(
                max(b["balance"]["unaccounted_kg"], 0.0) for b in batches if b["balance"]["complete"]
            ),
            "utilization_pct": capacity["week"]["pct"],
            "utilization_band": capacity["week"]["band"],
            "held_kg": float(held or 0),
            "vale_open_php": vale["open_php"],
        }

    # ── milling ───────────────────────────────────────────────────────────────

    def batches(self, *, limit: int = 30) -> list[dict]:
        """The latest batches with outputs weighed, each with where its kilos went."""
        settings = self.get_settings()
        rows = (
            self.db.query(MillingBatch)
            .options(selectinload(MillingBatch.inputs), selectinload(MillingBatch.outputs))
            .filter(MillingBatch.company_id == self._company_id, MillingBatch.status != "cancelled")
            .filter(*self._viewed(MillingBatch))
            .order_by(MillingBatch.start_datetime.desc())
            .limit(limit)
            .all()
        )
        out = []
        for b in rows:
            if not b.outputs:  # still milling, with nothing weighed yet
                continue
            balance = mass_balance(
                sum(float(i.input_weight_kg) for i in b.inputs),
                [
                    (
                        o.output_type,
                        float(o.output_weight_kg),
                        float(o.broken_rice_pct) if o.broken_rice_pct is not None else None,
                    )
                    for o in b.outputs
                ],
            )
            out.append(
                {
                    "id": str(b.id),
                    "batch_no": b.batch_no,
                    "start_datetime": b.start_datetime,
                    "balance": balance,
                    "alerts": batch_alerts(balance, settings),
                }
            )
        return out

    def trace(self, batch_id: uuid.UUID) -> dict:
        """A batch end to end: the purchases its palay came from, how they dried, and
        what came out."""
        b = (
            self.db.query(MillingBatch)
            .options(selectinload(MillingBatch.inputs), selectinload(MillingBatch.outputs))
            .filter(MillingBatch.id == batch_id, MillingBatch.company_id == self._company_id)
            .first()
        )
        if b is None:
            raise NotFoundError("Batch not found")
        customer = self.db.get(Customer, b.customer_id) if b.customer_id else None
        lots = []
        rows = (
            self.db.query(MillingInputLot, PalayPurchaseItem, PalayPurchase, Supplier)
            .join(MillingBatchInput, MillingBatchInput.id == MillingInputLot.input_id)
            .outerjoin(PalayPurchaseItem, PalayPurchaseItem.id == MillingInputLot.purchase_item_id)
            .outerjoin(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
            .outerjoin(Supplier, Supplier.id == PalayPurchase.supplier_id)
            .filter(MillingBatchInput.batch_id == b.id)
            .all()
        )
        for lot, line, purchase, supplier in rows:
            lots.append(
                {
                    "weight_kg": float(lot.weight_kg),
                    "reference_no": purchase.reference_no if purchase else None,
                    "purchase_date": purchase.purchase_date if purchase else None,
                    "supplier": supplier.name if supplier else None,
                    "moisture_pct": float(line.moisture_content_pct)
                    if line and line.moisture_content_pct is not None
                    else None,
                    "bought_kg": float(line.net_weight_kg) if line else None,
                    "dried_kg": float(line.dried_weight_kg) if line and line.dried_weight_kg is not None else None,
                    "dried_moisture_pct": float(line.dried_moisture_pct)
                    if line and line.dried_moisture_pct is not None
                    else None,
                }
            )
        return {
            "id": str(b.id),
            "batch_no": b.batch_no,
            "client": customer.name if customer else None,
            "lots": lots,
            "outputs": [{"output_type": o.output_type, "weight_kg": float(o.output_weight_kg)} for o in b.outputs],
            "input_kg": sum(float(i.input_weight_kg) for i in b.inputs),
        }

    # ── buying: the most to pay ───────────────────────────────────────────────

    def max_buy(self) -> dict:
        """Per palay variety bought lately: the most to pay per kg at today's rice price,
        and at imported rice's landed price when that's lower."""
        settings = self.get_settings()
        profit = ProfitService(self.db, self.current_user)
        margin = profit.get_settings()["target_margin_pct"]
        data = profit._gather()
        landed = landed_price(
            settings["cif_usd_per_ton"], settings["usd_php"], settings["tariff_pct"], settings["landed_other_per_kg"]
        )
        rows = []
        for v in profit._palay_varieties():
            d = profit._variety_defaults(v, data)
            if d["palay_price"] is None and d["market_price"] is None:
                continue

            def most(price: float | None, d: dict = d) -> float | None:
                if price is None:
                    return None
                return max_palay_price(
                    rice_price=price,
                    recovery_pct=d["recovery_pct"],
                    moisture_pct=d["moisture_pct"],
                    byproducts=[(d[f"{k}_pct"], d[f"{k}_price"] or 0.0) for k in BYPRODUCTS],
                    other_cost_per_kg=d["other_cost_per_kg"],
                    target_margin_pct=margin,
                )

            prices = [p for p in (d["market_price"], landed) if p is not None]
            rows.append(
                {
                    "variety_id": d["variety_id"],
                    "code": d["code"],
                    "name": d["name"],
                    "paying_per_kg": d["palay_price"],
                    "recovery_pct": d["recovery_pct"],
                    "market_price": d["market_price"],
                    "max_at_market": most(d["market_price"]),
                    "max_at_import": most(landed),
                    "max_buy": most(min(prices)) if prices else None,
                }
            )
        return {"landed_price": landed, "target_margin_pct": margin, "rows": rows}

    # ── costs ─────────────────────────────────────────────────────────────────

    def cost_per_sack(self) -> dict:
        """What a sack of each rice costs to make, by-product income taken off."""
        settings = self.get_settings()
        kg_per_sack = float(settings["kg_per_sack"]) or 50.0
        packaging = float(settings["packaging_per_sack"])
        profit = ProfitService(self.db, self.current_user)
        margin = profit.get_settings()["target_margin_pct"]
        data = profit._gather()
        rows = []
        for v in profit._palay_varieties():
            d = profit._variety_defaults(v, data)
            if d["palay_price"] is None:
                continue
            plan = price_plan(
                palay_kg=d["palay_kg"],
                palay_price=d["palay_price"],
                moisture_pct=d["moisture_pct"],
                recovery_pct=d["recovery_pct"],
                other_costs=d["palay_kg"] * d["other_cost_per_kg"],
                byproducts=[(d[f"{k}_pct"], d[f"{k}_price"] or 0.0) for k in BYPRODUCTS],
                target_margin_pct=margin,
                market_price=d["market_price"],
            )
            if plan is None:
                continue
            palay_per_sack = d["palay_kg"] * d["palay_price"] / plan["rice_kg"] * kg_per_sack
            other_per_sack = d["palay_kg"] * d["other_cost_per_kg"] / plan["rice_kg"] * kg_per_sack
            byproduct_per_sack = plan["byproduct_income"] / plan["rice_kg"] * kg_per_sack
            total = palay_per_sack + other_per_sack - byproduct_per_sack + packaging
            market = d["market_price"] * kg_per_sack if d["market_price"] else None
            rows.append(
                {
                    "variety_id": d["variety_id"],
                    "code": d["code"],
                    "name": d["name"],
                    "palay": palay_per_sack,
                    "other": other_per_sack,
                    "packaging": packaging,
                    "byproducts": byproduct_per_sack,
                    "total": total,
                    "market": market,
                    "below_cost": market is not None and market < total,
                }
            )
        return {"kg_per_sack": kg_per_sack, "rows": rows}

    def price_check(self, items: list[dict]) -> list[dict]:
        """Which proposed prices are under cost. Only the Boss gets the figure: anyone
        else learns only that the price is too low, so it can't be worked back."""
        floors = price_floor(self.db, self.current_user)
        boss = getattr(getattr(self.current_user, "role", None), "name", None) == "owner"
        out = []
        for item in items:
            floor = floors.get(item["variety_id"], floors.get(None))
            below = floor is not None and item["price"] < floor
            out.append({"below": below, "floor": round(floor, 2) if boss and floor is not None else None})
        return out

    def capacity(self) -> dict:
        """Palay milled today, this week and each of the last eight weeks, against what
        the machines that set the mill's capacity are rated for."""
        settings = self.get_settings()
        branch = viewed_branch(self.db)
        machines = (
            self.db.query(MillingEquipment)
            .filter(
                MillingEquipment.company_id == self._company_id,
                MillingEquipment.is_active.is_(True),
                MillingEquipment.counts_for_capacity.is_(True),
                MillingEquipment.capacity_kg_per_hr.isnot(None),
                MillingEquipment.rated_hours_per_day.isnot(None),
            )
            .filter(*([MillingEquipment.branch_id == branch] if branch else []))
            .all()
        )
        per_day = 0.0
        for m in machines:  # both figures are there: filtered above
            per_day += float(m.capacity_kg_per_hr or 0) * float(m.rated_hours_per_day or 0)
        days = int(settings["working_days_per_week"])
        today = self._today()
        monday = today - timedelta(days=today.weekday())

        def milled(start: date, end: date) -> float:
            total = (
                self.db.query(func.sum(MillingBatchInput.input_weight_kg))
                .join(MillingBatch, MillingBatch.id == MillingBatchInput.batch_id)
                .filter(
                    MillingBatch.company_id == self._company_id,
                    MillingBatch.status != "cancelled",
                    func.date(MillingBatch.start_datetime) >= start,
                    func.date(MillingBatch.start_datetime) <= end,
                    *self._viewed(MillingBatch),
                )
                .scalar()
            )
            return float(total or 0)

        def row(kg: float, rated: float) -> dict:
            pct = round(kg / rated * 100, 1) if rated > 0 else None
            return {"milled_kg": kg, "rated_kg": rated or None, "pct": pct, "band": utilization_band(pct, settings)}

        weeks = []
        for n in range(8):
            start = monday - timedelta(days=7 * n)
            weeks.append({"week_of": start, **row(milled(start, start + timedelta(days=6)), per_day * days)})
        return {
            "machines": len(machines),
            "rated_per_day_kg": per_day or None,
            "today": row(milled(today, today), per_day),
            "week": weeks[0],
            "weeks": weeks,
            "settings": {
                "break_even": settings["break_even_utilization_pct"],
                "optimal_low": settings["optimal_low_pct"],
                "optimal_high": settings["optimal_high_pct"],
            },
        }

    # ── the warehouse ─────────────────────────────────────────────────────────

    def _layouts(self) -> list[uuid.UUID]:
        q = self.db.query(WarehouseLayout.id).filter(
            WarehouseLayout.company_id == self._company_id, WarehouseLayout.deleted_at.is_(None)
        )
        return [lid for (lid,) in q.filter(*self._viewed(WarehouseLayout)).all()]

    def warehouse(self) -> dict:
        """Pallets oldest first, holds, zone readings against their targets, and how
        long each by-product has sat."""
        today = self._today()
        layouts = self._layouts()
        pallets = (
            (
                self.db.query(Pallet)
                .options(selectinload(Pallet.batches).selectinload(RiceBatch.variety))
                .filter(Pallet.layout_id.in_(layouts), Pallet.status.in_(("in_storage", "on_hold")))
                .all()
            )
            if layouts
            else []
        )
        pallet_rows = []
        for p in pallets:
            if not p.batches:
                continue
            first = min(p.batches, key=lambda b: b.milling_date)
            pallet_rows.append(
                {
                    "id": str(p.id),
                    "pallet_code": p.pallet_code,
                    "variety_code": first.variety.code if first.variety else None,
                    "weight_kg": float(p.weight_kg),
                    "milling_date": first.milling_date,
                    "days_old": (today - first.milling_date).days,
                    "aging_status": first.status,
                    "status": p.status,
                    "date_assumed": first.client_name == ASSUMED_DATE_CLIENT,
                    "pick_first_reason": p.pick_first_reason,
                }
            )
        pallet_rows.sort(key=lambda r: (r["pick_first_reason"] is None, r["milling_date"]))

        holds = (
            self.db.query(StockHold)
            .filter(StockHold.company_id == self._company_id, StockHold.cleared_at.is_(None), *self._viewed(StockHold))
            .order_by(StockHold.placed_at.desc())
            .all()
        )
        codes = {r["id"]: r["pallet_code"] for r in pallet_rows}

        zones = (
            self.db.query(WarehouseZone).filter(WarehouseZone.layout_id.in_(layouts)).order_by(WarehouseZone.name).all()
            if layouts
            else []
        )
        zone_rows = []
        for z in zones:
            if z.target_humidity_pct is None and z.target_temp_c is None and "storage" not in z.zone_type:
                continue
            last = (
                self.db.query(ZoneReading)
                .filter(ZoneReading.zone_id == z.id)
                .order_by(ZoneReading.read_at.desc())
                .first()
            )
            high_humidity = bool(
                last
                and last.humidity_pct is not None
                and z.target_humidity_pct is not None
                and last.humidity_pct > z.target_humidity_pct
            )
            high_temp = bool(
                last and last.temp_c is not None and z.target_temp_c is not None and last.temp_c > z.target_temp_c
            )
            zone_rows.append(
                {
                    "id": str(z.id),
                    "name": z.name,
                    "target_humidity_pct": float(z.target_humidity_pct) if z.target_humidity_pct is not None else None,
                    "target_temp_c": float(z.target_temp_c) if z.target_temp_c is not None else None,
                    "humidity_pct": float(last.humidity_pct) if last and last.humidity_pct is not None else None,
                    "temp_c": float(last.temp_c) if last and last.temp_c is not None else None,
                    "read_at": last.read_at if last else None,
                    "out_of_range": high_humidity or high_temp,
                }
            )
        return {
            "pallets": pallet_rows,
            "holds": [
                {
                    "id": str(h.id),
                    "pallet_code": codes.get(str(h.pallet_id)) if h.pallet_id else None,
                    "stock_type": h.stock_type,
                    "byproduct_type": h.byproduct_type,
                    "variety_id": str(h.variety_id) if h.variety_id else None,
                    "weight_kg": float(h.weight_kg),
                    "reason": h.reason,
                    "note": h.note,
                    "placed_at": h.placed_at,
                }
                for h in holds
            ],
            "zones": zone_rows,
            "byproducts": self.byproducts(),
        }

    def byproducts(self) -> list[dict]:
        """Each by-product: on hand, sold in the last 30 days, how old the stock is, and
        whether fresh bran has sat too long."""
        settings = self.get_settings()
        today = self._today()
        rows = (
            self.db.query(ByproductInventory.byproduct_type, func.sum(ByproductInventory.quantity_kg))
            .filter(ByproductInventory.company_id == self._company_id, *self._viewed(ByproductInventory))
            .group_by(ByproductInventory.byproduct_type)
            .all()
        )
        out = []
        for kind, on_hand in rows:
            base = (StockMovement.company_id == self._company_id, StockMovement.byproduct_type == kind)
            receipts = (
                self.db.query(StockMovement.created_at, StockMovement.delta_kg)
                .filter(*base, StockMovement.delta_kg > 0, StockMovement.source_type != "sales_order")
                .filter(*self._viewed(StockMovement))
                .order_by(StockMovement.created_at.desc())
                .all()
            )
            sold = (
                self.db.query(func.sum(StockMovement.delta_kg))
                .filter(
                    *base,
                    StockMovement.source_type == "sales_order",
                    StockMovement.created_at >= datetime.now(timezone.utc) - timedelta(days=30),
                    *self._viewed(StockMovement),
                )
                .scalar()
            )
            since = unsold_since(float(on_hand or 0), [(w, float(k)) for w, k in receipts])
            days = (today - since.date()).days if isinstance(since, datetime) else None
            out.append(
                {
                    "byproduct_type": kind,
                    "on_hand_kg": float(on_hand or 0),
                    "sold_30d_kg": -float(sold or 0),
                    "oldest_days": days,
                    "stale": kind == "darak" and days is not None and days > int(settings["bran_fresh_days"]),
                }
            )
        return sorted(out, key=lambda r: r["byproduct_type"])

    def movements(self, *, stock_type: str | None = None, limit: int = 100) -> list[dict]:
        q = self.db.query(StockMovement).filter(StockMovement.company_id == self._company_id)
        if stock_type:
            q = q.filter(StockMovement.stock_type == stock_type)
        rows = q.filter(*self._viewed(StockMovement)).order_by(StockMovement.created_at.desc()).limit(limit).all()
        return [
            {
                "id": str(m.id),
                "stock_type": m.stock_type,
                "byproduct_type": m.byproduct_type,
                "grade_name": m.grade_name,
                "delta_kg": float(m.delta_kg),
                "balance_after_kg": float(m.balance_after_kg),
                "source_type": m.source_type,
                "notes": m.notes,
                "created_at": m.created_at,
            }
            for m in rows
        ]

    def _pallet(self, pallet_id: uuid.UUID) -> Pallet:
        pallet = self.db.get(Pallet, pallet_id)
        if pallet is None or pallet.company_id != self._company_id:
            raise NotFoundError("Pallet not found")
        return pallet

    def pick_first(self, pallet_id: uuid.UUID, reason: str | None) -> dict:
        pallet = self._pallet(pallet_id)
        with self.transaction():
            pallet_flow.pick_first(self.db, self.current_user, pallet, reason)
        return {"id": str(pallet.id), "pick_first_reason": pallet.pick_first_reason}

    def place_hold(self, data: Any) -> dict:
        branch = viewed_branch(self.db) or self.current_user.branch_id
        values: dict[str, Any] = {
            "stock_type": data.stock_type,
            "variety_id": data.variety_id,
            "grade_name": data.grade_name,
            "byproduct_type": data.byproduct_type,
            "weight_kg": data.weight_kg,
        }
        pallet = None
        if data.pallet_id:
            pallet = self._pallet(data.pallet_id)
            if pallet.status != "in_storage":
                raise ConflictError("This pallet isn't in storage.", code="pallet_not_in_storage")
            layout = self.db.get(WarehouseLayout, pallet.layout_id)
            first = pallet.batches[0] if pallet.batches else None
            branch = layout.branch_id if layout else branch
            values.update(
                stock_type="milled_rice",
                variety_id=first.variety_id if first else None,
                grade_name=None,
                byproduct_type=None,
                weight_kg=pallet.weight_kg,
            )
        elif not values["weight_kg"]:
            raise ValidationError("Say how many kilos to hold.")
        elif data.stock_type == "byproduct" and not data.byproduct_type:
            raise ValidationError("Say which by-product to hold.")
        elif data.stock_type != "byproduct" and not data.variety_id:
            raise ValidationError("Say which variety to hold.")
        with self.transaction():
            hold = StockHold(
                company_id=self._company_id,
                branch_id=branch,
                pallet_id=pallet.id if pallet else None,
                reason=data.reason,
                note=(data.note or "").strip() or None,
                placed_by=self.current_user.id,
                **values,
            )
            self.db.add(hold)
            if pallet:
                pallet.status = "on_hold"
            self.db.flush()
            log_changes(
                self.db,
                user=self.current_user,
                action="stock_hold.placed",
                entity_type="stock_hold",
                entity_id=hold.id,
                entity_label=pallet.pallet_code if pallet else data.stock_type,
                lines=[f"On hold: {float(hold.weight_kg):,.0f} kg, {hold.reason}"],
            )
        return {"id": str(hold.id)}

    def clear_hold(self, hold_id: uuid.UUID, note: str | None) -> dict:
        hold = self.db.get(StockHold, hold_id)
        if hold is None or hold.company_id != self._company_id:
            raise NotFoundError("Hold not found")
        if hold.cleared_at is not None:
            raise ConflictError("This hold has already been cleared.", code="hold_cleared")
        with self.transaction():
            hold.cleared_at = datetime.now(timezone.utc)
            hold.cleared_by = self.current_user.id
            hold.cleared_note = (note or "").strip() or None
            if hold.pallet_id:
                pallet = self.db.get(Pallet, hold.pallet_id)
                if pallet is not None and pallet.status == "on_hold":
                    pallet.status = "in_storage"
            log_changes(
                self.db,
                user=self.current_user,
                action="stock_hold.cleared",
                entity_type="stock_hold",
                entity_id=hold.id,
                entity_label=hold.stock_type,
                lines=[
                    f"Cleared: {float(hold.weight_kg):,.0f} kg"
                    + (f", {hold.cleared_note}" if hold.cleared_note else "")
                ],
            )
        return {"id": str(hold.id)}

    def add_reading(self, data: Any) -> dict:
        zone = self.db.get(WarehouseZone, data.zone_id)
        layout = self.db.get(WarehouseLayout, zone.layout_id) if zone else None
        if zone is None or layout is None or layout.company_id != self._company_id:
            raise NotFoundError("Zone not found")
        with self.transaction():
            self.db.add(
                ZoneReading(
                    company_id=self._company_id,
                    zone_id=zone.id,
                    humidity_pct=data.humidity_pct,
                    temp_c=data.temp_c,
                    note=(data.note or "").strip() or None,
                    read_by=self.current_user.id,
                )
            )
        return {"zone_id": str(zone.id)}

    # ── vale ──────────────────────────────────────────────────────────────────

    def advances(self) -> dict:
        rows = (
            self.db.query(SupplierAdvance)
            .options(selectinload(SupplierAdvance.settlements), selectinload(SupplierAdvance.supplier))
            .filter(SupplierAdvance.company_id == self._company_id, SupplierAdvance.is_void.is_(False))
            .filter(*self._viewed(SupplierAdvance))
            .order_by(SupplierAdvance.advance_date.desc(), SupplierAdvance.created_at.desc())
            .all()
        )
        out = []
        for a in rows:
            settled = sum(float(s.amount) for s in a.settlements)
            out.append(
                {
                    "id": str(a.id),
                    "supplier_id": str(a.supplier_id),
                    "supplier": a.supplier.name if a.supplier else None,
                    "advance_date": a.advance_date,
                    "kind": a.kind,
                    "amount": float(a.amount),
                    "settled": settled,
                    "open": float(a.amount) - settled,
                    "note": a.note,
                }
            )
        return {"rows": out, "open_php": sum(r["open"] for r in out)}

    def create_advance(self, data: Any) -> dict:
        self.assert_company_fk(Supplier, data.supplier_id, label="Supplier")
        with self.transaction():
            advance = SupplierAdvance(
                company_id=self._company_id,
                branch_id=viewed_branch(self.db) or self.current_user.branch_id,
                supplier_id=data.supplier_id,
                advance_date=data.advance_date,
                kind=data.kind,
                amount=data.amount,
                note=(data.note or "").strip() or None,
                created_by=self.current_user.id,
            )
            self.db.add(advance)
            self.db.flush()
            log_changes(
                self.db,
                user=self.current_user,
                action="supplier_advance.created",
                entity_type="supplier_advance",
                entity_id=advance.id,
                entity_label=str(data.advance_date),
                lines=[f"Vale of ₱{float(data.amount):,.2f}, {data.kind}"],
            )
        return {"id": str(advance.id)}

    def void_advance(self, advance_id: uuid.UUID) -> dict:
        advance = self.db.get(SupplierAdvance, advance_id)
        if advance is None or advance.company_id != self._company_id:
            raise NotFoundError("Advance not found")
        if advance.settlements:
            raise ConflictError(
                "Part of this vale was already taken off a purchase, so it can't be voided.", code="vale_settled"
            )
        with self.transaction():
            advance.is_void = True
            log_changes(
                self.db,
                user=self.current_user,
                action="supplier_advance.voided",
                entity_type="supplier_advance",
                entity_id=advance.id,
                entity_label=str(advance.advance_date),
                lines=[f"Vale of ₱{float(advance.amount):,.2f} voided"],
            )
        return {"id": str(advance.id)}
