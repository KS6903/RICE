"""ProfitService — the Profit calculator: what to charge so a mill doesn't lose
money, and what it earns at that price. Read-only over purchases, milling, sales
and expenses, apart from the Boss's two settings.

The real figures go to the Boss alone. Anyone else the Boss opens the page to gets
``varieties`` in its staff shape: the recommended price and a lower profit, the
real one times the Boss's staff %, and nothing it could be worked back from.

The formulas are in ``price_plan`` and, for instant results while typing, in the
web app's mappers/ProfitMapper.ts. Both are tested with the same worked example.
"""

from __future__ import annotations

import math
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy import func, or_
from sqlalchemy.orm import selectinload

from ..core.branch_scope import viewed_branch
from ..core.exceptions import NotFoundError
from ..core.timezones import local_today
from ..models.buying import ByproductPurchase, ByproductPurchaseItem, RicePurchase, RicePurchaseItem
from ..models.company import Company
from ..models.costs import Expense, ExpenseCategory
from ..models.milling import MillingBatch
from ..models.paddy import KG_PER_CAVAN, PalayPurchase, PalayPurchaseItem, PalayRecoveryTest
from ..models.reference import RiceVariety
from ..models.sales import SalesOrder, SalesOrderItem
from ..services.base import BaseService

STANDARD_MOISTURE_PCT = 14.0
DEFAULT_RECOVERY_PCT = 65.0
HULL_PCT = 20.0
BRAN_PCT = 10.0
DEFAULT_TARGET_MARGIN_PCT = 10.0
DEFAULT_STAFF_PROFIT_PCT = 30.0
# How far back the averages that fill the calculator look.
LOOKBACK_DAYS = 90
# Orders that really sold something, for what the market pays. The period's sales
# count invoiced and paid only, as the Reports page's profit and loss does.
SOLD_STATUSES = ("confirmed", "delivered", "invoiced", "paid")
INVOICED_STATUSES = ("invoiced", "paid")
BYPRODUCTS = ("ipa", "darak", "binlid")


def is_boss(user: Any) -> bool:
    """Whether this person sees the real figures. Only the mill's own Boss does:
    never a platform admin or a made-up role, whatever else they can open."""
    if getattr(user, "is_platform_admin", False) or getattr(user, "custom_role", None) is not None:
        return False
    return getattr(getattr(user, "role", None), "name", None) == "owner"


def _round_up_half_peso(price: float) -> float:
    # round() first: float noise must not push an exact ₱34.50 up to ₱35.
    return max(math.ceil(round(price * 2, 6)) / 2, 0.5)


def price_plan(
    *,
    palay_kg: float,
    palay_price: float,
    moisture_pct: float | None,
    recovery_pct: float,
    other_costs: float,
    byproducts: Iterable[tuple[float, float]],
    target_margin_pct: float,
    market_price: float | None,
) -> dict | None:
    """The selling price for a lot of palay, from its recovery. ``byproducts`` is
    (% of the palay, ₱ per kg). None until there's rice to price and a cost to cover.

    Palay wetter than 14% is weighed down to 14% for what it yields, but is paid
    for at the weight it was bought; drier palay is left as weighed.
    """
    wet = moisture_pct is not None and STANDARD_MOISTURE_PCT < moisture_pct < 100
    standard_kg = palay_kg * (100 - moisture_pct) / (100 - STANDARD_MOISTURE_PCT) if wet else palay_kg
    rice_kg = standard_kg * recovery_pct / 100
    total_cost = palay_kg * palay_price + other_costs
    if rice_kg <= 0 or total_cost <= 0:
        return None

    byproduct_income = sum(standard_kg * pct / 100 * price for pct, price in byproducts)
    break_even = (total_cost - byproduct_income) / rice_kg
    target_price = _round_up_half_peso(break_even / (1 - target_margin_pct / 100))
    market = market_price if market_price is not None and market_price > 0 else None
    losing = market is not None and market <= break_even
    recommended = market if market is not None and not losing else target_price
    margin_pct = (recommended - break_even) / recommended * 100

    plan = {
        "rice_kg": rice_kg,
        "total_cost": total_cost,
        "byproduct_income": byproduct_income,
        "break_even": break_even,
        "target_price": target_price,
        "recommended_price": recommended,
        "margin_pct": margin_pct,
        "profit": recommended * rice_kg + byproduct_income - total_cost,
        "verdict": "losing" if losing else "good" if margin_pct >= target_margin_pct else "thin",
        "loss_per_kg": None,
        "recovery_needed_pct": None,
        "max_palay_price": None,
    }
    if market is not None and losing:
        plan["loss_per_kg"] = break_even - market
        plan["recovery_needed_pct"] = (total_cost - byproduct_income) / (market * standard_kg) * 100
        plan["max_palay_price"] = (market * rice_kg + byproduct_income - other_costs) / palay_kg
    return plan


def staff_view(plan: dict | None, staff_pct: float) -> dict:
    """What staff are shown of a plan. A loss gets no number: scaling it down would
    make it look smaller, and it would say how far the price is from break-even."""
    if plan is None:
        return {"recommended_price": None, "estimated_profit_per_kg": None, "verdict": "no_data"}
    per_kg = plan["recommended_price"] - plan["break_even"]
    shown = round(per_kg * staff_pct / 100, 2) if per_kg > 0 and plan["verdict"] != "losing" else None
    return {
        "recommended_price": round(plan["recommended_price"], 2),
        "estimated_profit_per_kg": shown,
        "verdict": plan["verdict"],
    }


class ProfitService(BaseService):
    @property
    def _company_id(self):
        return self.current_user.company_id

    def _viewed(self, model: Any) -> list:
        """The filter keeping a figure to the branch the Boss is looking at (none for all)."""
        branch = viewed_branch(self.db)
        return [model.branch_id == branch] if branch is not None else []

    def _today(self) -> date:
        return local_today(getattr(self.db.get(Company, self._company_id), "timezone", None))

    # ── settings (the Boss's) ─────────────────────────────────────────────────

    def get_settings(self) -> dict:
        company = self.db.get(Company, self._company_id)
        target = company.profit_target_margin_pct if company else None
        staff = company.staff_profit_pct if company else None
        return {
            "target_margin_pct": float(target) if target is not None else DEFAULT_TARGET_MARGIN_PCT,
            "staff_profit_pct": float(staff) if staff is not None else DEFAULT_STAFF_PROFIT_PCT,
        }

    def set_settings(self, target_margin_pct: float | None, staff_profit_pct: float | None) -> dict:
        company = self.db.get(Company, self._company_id)
        if company is None:
            raise NotFoundError("Company not found")
        with self.transaction():
            if target_margin_pct is not None:
                company.profit_target_margin_pct = Decimal(str(target_margin_pct))
            if staff_profit_pct is not None:
                company.staff_profit_pct = Decimal(str(staff_profit_pct))
        return self.get_settings()

    # ── what fills the calculator ─────────────────────────────────────────────

    def _palay_varieties(self) -> list[RiceVariety]:
        return (
            self.db.query(RiceVariety)
            .filter(
                or_(RiceVariety.company_id == self._company_id, RiceVariety.company_id.is_(None)),
                RiceVariety.kind.in_(("palay", "both")),
                RiceVariety.is_active.is_(True),
            )
            .order_by(RiceVariety.code)
            .all()
        )

    def _palay_bought(self, since: date, until: date | None = None) -> dict[uuid.UUID | None, dict]:
        """Per variety since a date: kilos as bought, what they cost, and the moisture
        they were bought at, averaged over the kilos it was read for."""
        items = (
            self.db.query(PalayPurchaseItem)
            .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
            .filter(
                PalayPurchase.company_id == self._company_id,
                PalayPurchase.purchase_date >= since,
                PalayPurchase.purchase_date <= (until or self._today()),
                PalayPurchase.status != "cancelled",
                *self._viewed(PalayPurchase),
            )
            .all()
        )
        out: dict[uuid.UUID | None, dict] = {}
        for i in items:
            kg = float(i.net_weight_kg)
            row = out.setdefault(i.variety_id, {"kg": 0.0, "amount": 0.0, "moist_kg": 0.0, "moist_sum": 0.0})
            row["kg"] += kg
            row["amount"] += kg / float(KG_PER_CAVAN) * float(i.price_per_cavan)
            if i.moisture_content_pct is not None:
                row["moist_kg"] += kg
                row["moist_sum"] += kg * float(i.moisture_content_pct)
        return out

    def _batches(self, since: date, until: date | None = None) -> list[MillingBatch]:
        q = (
            self.db.query(MillingBatch)
            .options(selectinload(MillingBatch.inputs), selectinload(MillingBatch.outputs))
            .filter(
                MillingBatch.company_id == self._company_id,
                MillingBatch.status == "completed",
                func.date(MillingBatch.start_datetime) >= since,
                *self._viewed(MillingBatch),
            )
        )
        if until is not None:
            q = q.filter(func.date(MillingBatch.start_datetime) <= until)
        return q.all()

    @staticmethod
    def _yields(batches: list[MillingBatch]) -> dict[uuid.UUID | None, dict]:
        """Per variety: what its batches gave. A batch of several varieties can't say
        which gave what, so it is left out."""
        out: dict[uuid.UUID | None, dict] = {}
        for b in batches:
            varieties = {i.variety_id for i in b.inputs}
            if len(varieties) != 1 or None in varieties:
                continue
            row = out.setdefault(
                next(iter(varieties)),
                {"input": 0.0, "milled": 0.0, "head": 0.0, "head_input": 0.0, "ipa": 0.0, "darak": 0.0, "binlid": 0.0},
            )
            row.setdefault("rice_varieties", set())
            batch_input = sum(float(i.input_weight_kg) for i in b.inputs)
            row["input"] += batch_input
            for o in b.outputs:
                kg = float(o.output_weight_kg)
                if o.output_type == "milled_rice":
                    row["milled"] += kg
                    # Palay and rice have their own variety lists: this is what the
                    # palay was sold as.
                    if o.variety_id is not None:
                        row["rice_varieties"].add(o.variety_id)
                    if o.broken_rice_pct is not None:
                        row["head"] += kg * (100 - float(o.broken_rice_pct)) / 100
                        row["head_input"] += batch_input
                elif o.output_type in BYPRODUCTS:
                    row[o.output_type] += kg
        return out

    def _recovery_tests(self, since: date) -> dict[uuid.UUID, float]:
        rows = (
            self.db.query(
                PalayRecoveryTest.variety_id,
                func.sum(PalayRecoveryTest.milled_kg),
                func.sum(PalayRecoveryTest.sample_kg),
            )
            .join(PalayPurchase, PalayPurchase.id == PalayRecoveryTest.purchase_id)
            .filter(
                PalayRecoveryTest.company_id == self._company_id,
                func.date(PalayRecoveryTest.created_at) >= since,
                *self._viewed(PalayPurchase),
            )
            .group_by(PalayRecoveryTest.variety_id)
            .all()
        )
        return {v: float(m) / float(s) * 100 for v, m, s in rows if v is not None and s}

    def _sold(self, item_type: str, statuses: tuple[str, ...], since: date, until: date | None = None) -> list:
        """Sold lines of one type, grouped by variety and by-product: kilos and pesos,
        each line's share of its order's discount taken off."""
        amount = (
            SalesOrderItem.quantity_kg
            * SalesOrderItem.unit_price_per_kg
            * func.coalesce(SalesOrder.total_amount / func.nullif(SalesOrder.subtotal, 0), 1)
        )
        q = (
            self.db.query(
                SalesOrderItem.variety_id,
                SalesOrderItem.byproduct_type,
                func.sum(SalesOrderItem.quantity_kg),
                func.sum(amount),
            )
            .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id)
            .filter(
                SalesOrder.company_id == self._company_id,
                SalesOrder.status.in_(statuses),
                SalesOrder.order_date >= since,
                SalesOrderItem.item_type == item_type,
                *self._viewed(SalesOrder),
            )
        )
        if until is not None:
            q = q.filter(SalesOrder.order_date <= until)
        return q.group_by(SalesOrderItem.variety_id, SalesOrderItem.byproduct_type).all()

    def _other_cost_per_kg(self, batches: list[MillingBatch]) -> float:
        """Production expenses linked to these batches, per kilo of palay they milled."""
        milled = sum(float(i.input_weight_kg) for b in batches for i in b.inputs)
        if not batches or milled <= 0:
            return 0.0
        spent = (
            self.db.query(func.sum(Expense.amount))
            .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
            .filter(
                Expense.company_id == self._company_id,
                Expense.batch_id.in_([b.id for b in batches]),
                ExpenseCategory.is_production_cost.is_(True),
            )
            .scalar()
        )
        return float(spent or 0) / milled

    def _gather(self) -> dict:
        """Everything the averages come from, read once for all the varieties."""
        since = self._today() - timedelta(days=LOOKBACK_DAYS)
        batches = self._batches(since)
        market_rows = self._sold("milled_rice", SOLD_STATUSES, since)
        market: dict[uuid.UUID | None, list[float]] = {}
        for variety, _, kg, amount in market_rows:
            row = market.setdefault(variety, [0.0, 0.0])
            row[0] += float(kg or 0)
            row[1] += float(amount or 0)
        byproduct_price = {
            kind: float(amount) / float(kg)
            for _, kind, kg, amount in self._sold("byproduct", SOLD_STATUSES, since)
            if kind and kg
        }
        return {
            "bought": self._palay_bought(since),
            "yields": self._yields(batches),
            "tests": self._recovery_tests(since),
            "market": market,
            "byproduct_price": byproduct_price,
            "other_cost_per_kg": self._other_cost_per_kg(batches),
        }

    @staticmethod
    def _market_price(v: RiceVariety, made: dict | None, market: dict) -> tuple[float | None, str | None]:
        """What buyers pay for the rice this palay gives, and how that was found: its
        own sales, the rice its batches were sold as, or all the mill's rice."""

        def average(varieties: Iterable) -> float | None:
            rows = [market[x] for x in varieties if x in market]
            kg = sum(r[0] for r in rows)
            return sum(r[1] for r in rows) / kg if kg > 0 else None

        for varieties, source in (
            ([v.id], "variety"),
            (made["rice_varieties"] if made else [], "milled"),
            (list(market), "all"),
        ):
            price = average(varieties)
            if price is not None:
                return price, source
        return None, None

    @staticmethod
    def _variety_defaults(v: RiceVariety, data: dict) -> dict:
        bought = data["bought"].get(v.id)
        made = data["yields"].get(v.id)
        made = made if made and made["input"] > 0 and made["milled"] > 0 else None

        if made:
            recovery, source = made["milled"] / made["input"] * 100, "batches"
        elif v.id in data["tests"]:
            recovery, source = data["tests"][v.id], "tests"
        elif v.typical_recovery_pct:
            recovery, source = float(v.typical_recovery_pct), "variety"
        else:
            recovery, source = DEFAULT_RECOVERY_PCT, "default"

        market_price, market_source = ProfitService._market_price(v, made, data["market"])

        def share(kind: str, fallback: float) -> float:
            return made[kind] / made["input"] * 100 if made else fallback

        return {
            "variety_id": str(v.id),
            "code": v.code,
            "name": v.name,
            "palay_kg": bought["kg"] if bought else None,
            "palay_price": bought["amount"] / bought["kg"] if bought and bought["kg"] > 0 else None,
            "moisture_pct": bought["moist_sum"] / bought["moist_kg"] if bought and bought["moist_kg"] > 0 else None,
            "recovery_pct": recovery,
            "recovery_source": source,
            "head_pct": made["head"] / made["head_input"] * 100 if made and made["head_input"] > 0 else None,
            "ipa_pct": share("ipa", HULL_PCT),
            "darak_pct": share("darak", BRAN_PCT),
            "binlid_pct": share("binlid", 0.0),
            "yields_source": "batches" if made else "default",
            "ipa_price": data["byproduct_price"].get("ipa"),
            "darak_price": data["byproduct_price"].get("darak"),
            "binlid_price": data["byproduct_price"].get("binlid"),
            "other_cost_per_kg": data["other_cost_per_kg"],
            "market_price": market_price,
            "market_source": market_source,
        }

    def defaults(self, variety_id: uuid.UUID) -> dict:
        """The Boss's calculator, filled from the mill's records for a variety."""
        variety = next((v for v in self._palay_varieties() if v.id == variety_id), None)
        if variety is None:
            raise NotFoundError("Variety not found")
        return self._variety_defaults(variety, self._gather())

    def varieties(self) -> list[dict]:
        """One row per palay variety bought lately. The Boss gets the real figures;
        anyone else, ``staff_view`` of them. Staff get no costs and no market price."""
        boss = is_boss(self.current_user)
        settings = self.get_settings()
        data = self._gather()
        rows = []
        for v in self._palay_varieties():
            d = self._variety_defaults(v, data)
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
            row = {"variety_id": d["variety_id"], "code": v.code, "name": v.name, "recovery_pct": d["recovery_pct"]}
            if boss:
                row.update(
                    verdict=plan["verdict"] if plan else "no_data",
                    break_even=plan["break_even"] if plan else None,
                    recommended_price=plan["recommended_price"] if plan else None,
                    margin_pct=plan["margin_pct"] if plan else None,
                    market_price=d["market_price"],
                )
            else:
                row.update(staff_view(plan, settings["staff_profit_pct"]))
            rows.append(row)
        return rows

    # ── this period, by good ──────────────────────────────────────────────────

    def period(self, start: date, end: date) -> dict:
        """What each good earned from start to end. The cost is an estimate: each kilo
        sold at the average that good cost lately, looking back past the start since
        stock sold now was often bought earlier. Milled by-products cost nothing here,
        because the rice carries the whole cost of the palay."""
        since = start - timedelta(days=LOOKBACK_DAYS)
        bought = self._palay_bought(since, end)
        palay_kg = sum(r["kg"] for r in bought.values())
        palay_amount = sum(r["amount"] for r in bought.values())
        palay_cost = palay_amount / palay_kg if palay_kg > 0 else None

        rice_items = (
            self.db.query(RicePurchaseItem)
            .join(RicePurchase, RicePurchase.id == RicePurchaseItem.purchase_id)
            .filter(
                RicePurchase.company_id == self._company_id,
                RicePurchase.purchase_date >= since,
                RicePurchase.purchase_date <= end,
                RicePurchase.status != "cancelled",
                *self._viewed(RicePurchase),
            )
            .all()
        )
        rice_kg = sum(float(i.weight_kg) for i in rice_items)
        rice_amount = sum(float(i.total_amount) for i in rice_items)

        byproduct_items = (
            self.db.query(ByproductPurchaseItem)
            .join(ByproductPurchase, ByproductPurchase.id == ByproductPurchaseItem.purchase_id)
            .filter(
                ByproductPurchase.company_id == self._company_id,
                ByproductPurchase.purchase_date >= since,
                ByproductPurchase.purchase_date <= end,
                ByproductPurchase.status != "cancelled",
                *self._viewed(ByproductPurchase),
            )
            .all()
        )
        byproduct_kg = sum(float(i.weight_kg) for i in byproduct_items)
        byproduct_amount = sum(float(i.total_amount) for i in byproduct_items)

        # The mill's own palay only: a client's isn't the mill's cost.
        own = [b for b in self._batches(since, end) if b.customer_id is None]
        milled_in = sum(float(i.input_weight_kg) for b in own for i in b.inputs)
        milled_rice = sum(float(o.output_weight_kg) for b in own for o in b.outputs if o.output_type == "milled_rice")
        milled_by = sum(float(o.output_weight_kg) for b in own for o in b.outputs if o.output_type != "milled_rice")

        production = self._expenses(since, end, production=True)
        rice_pool_kg = rice_kg + milled_rice
        rice_cost = (
            (rice_amount + milled_in * (palay_cost or 0.0) + production) / rice_pool_kg if rice_pool_kg > 0 else None
        )
        byproduct_pool_kg = byproduct_kg + milled_by
        byproduct_cost = byproduct_amount / byproduct_pool_kg if byproduct_pool_kg > 0 else None

        goods = []
        total = 0.0
        for good, item_type, cost_per_kg in (
            ("palay", "palay", palay_cost),
            ("rice", "milled_rice", rice_cost),
            ("byproduct", "byproduct", byproduct_cost),
        ):
            rows = self._sold(item_type, INVOICED_STATUSES, start, end)
            kg = sum(float(r[2] or 0) for r in rows)
            sales = sum(float(r[3] or 0) for r in rows)
            cost = kg * cost_per_kg if cost_per_kg is not None else None
            # With nothing to cost it against, no profit is claimed for that good.
            profit = sales - cost if cost is not None else None
            total += profit or 0.0
            goods.append({"good": good, "kg_sold": kg, "sales": sales, "cost": cost, "profit": profit})

        overhead = self._expenses(start, end, production=False)
        return {
            "period_start": start,
            "period_end": end,
            "goods": goods,
            "overhead": overhead,
            "total_profit": total - overhead,
        }

    def _expenses(self, since: date, until: date, *, production: bool) -> float:
        q = (
            self.db.query(func.sum(Expense.amount))
            .outerjoin(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
            .filter(
                Expense.company_id == self._company_id,
                Expense.expense_date >= since,
                Expense.expense_date <= until,
                *self._viewed(Expense),
            )
        )
        if production:
            q = q.filter(ExpenseCategory.is_production_cost.is_(True))
        else:
            q = q.filter(or_(ExpenseCategory.is_production_cost.is_(False), ExpenseCategory.id.is_(None)))
        return float(q.scalar() or 0)
