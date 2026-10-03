"""AI advisor: the mill's own figures, explained and turned into advice by
DeepSeek (Enterprise, and only after the owner switches AI on).

The split of work is the point of the design. Python computes every figure,
including the candidate figures advice needs: the kilos to buy for a week or
two, the highest palay price that still leaves a margin, the selling price
that would. The model picks among them, explains, and words the advice; the
figure check in automations.ai drops any sentence quoting a number it wasn't
given. Each notice leads with the advice and ends with the figures it rests
on. When the model can't answer, the figures go out alone with a line saying so.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, TypedDict
from zoneinfo import ZoneInfo

from pydantic import BaseModel, field_validator
from sqlalchemy import func

from ...jobs.schedule import MONDAY, Schedule, daily, monthly, weekly
from ...models.activity import ActivityLog
from ...models.costs import Expense, ExpenseCategory
from ...models.milling import MilledRiceInventory, MillingBatch, MillingBatchInput, MillingBatchOutput
from ...models.notification import Notification
from ...models.paddy import DryingRecord, PalayInventory, PalayPurchase, PalayPurchaseItem
from ...models.reference import RiceVariety
from ...models.sales import Invoice, Payment, PriceList, SalesOrder, SalesOrderItem
from ...models.supplier_customer import Customer, Supplier
from ...models.user import User
from .. import ai, credit
from ..base import Field, Notice, Recipe, RecipeContext
from ..format import KG_PER_CAVAN, kg, peso
from .reports import _reports, last_month, week_totals
from .stock import _forecast, _location
from .watch import _EDITABLE, EMAIL_FIELD, list_price

SAFE_MOISTURE = Decimal(14)  # % at which palay stores; drying takes it here
DEFAULT_RECOVERY = Decimal(63)
D0 = Decimal(0)


class _DryingLot(TypedDict):
    lot: str | None
    variety: str | None
    kg: float | int
    moisture_pct: float | int
    hours_since_bought: int
    drying_started: bool


def _n(v: Any, places: int = 0) -> float | int:
    """A plain number for the facts: whole by default, else rounded."""
    d = Decimal(v or 0)
    return int(d.quantize(Decimal(1))) if places == 0 else float(round(d, places))


def _change(now: Decimal | float, before: Decimal | float) -> float | None:
    """Percent change, precomputed so the model never does the sum."""
    now, before = Decimal(str(now or 0)), Decimal(str(before or 0))
    return float(round((now - before) / before * 100, 1)) if before else None


def advise(
    ctx: RecipeContext,
    *,
    title: str,
    dedupe_key: str,
    link: str,
    task: str,
    facts: dict[str, Any],
    figures: list[str],
    keys: tuple[ai.Key, ...],
    render: Callable[[dict[str, Any]], list[str]],
) -> Notice:
    """One notice: the model's advice, then the figures it was given."""
    facts = {"mill": ctx.company.name, "today": f"{ctx.local_today:%A %d %B %Y}", **facts}
    try:
        lines = [line for line in render(ai.ask(facts, keys, task=task, language=ctx.language)) if line]
    except ai.AIUnavailable:
        lines = []
    if not lines:
        lines = ["The AI advice couldn't be written this time. Here are the figures."]
    body = "\n".join(lines)
    if figures:
        body += "\n\nThe figures:\n" + "\n".join(figures)
    return Notice(title=title, body=body, link=link, dedupe_key=dedupe_key)


def _render(*parts: tuple[str, str]) -> Callable[[dict[str, Any]], list[str]]:
    """The headline, then each (key, heading): lists numbered under their
    heading, strings as a paragraph. Empty keys are skipped."""

    def render(answer: dict[str, Any]) -> list[str]:
        lines = [answer.get("headline", "")]
        for key, heading in parts:
            value = answer.get(key)
            if not value:
                continue
            lines.append("")
            if isinstance(value, list):
                if heading:
                    lines.append(heading)
                lines += [f"{i}. {item}" for i, item in enumerate(value, start=1)]
            else:
                lines.append(f"{heading} {value}".strip())
        return lines

    return render


HEADLINE = ai.Key("headline", "the single most useful thing for the owner to take from this", limit=180)


class _EmailOnly(BaseModel):
    email: bool = True


# ── shared figures ───────────────────────────────────────────────────────────


def _pairs(rows: Any) -> dict[Any, Any]:
    """{first column: second column} from a two-column query."""
    return {key: value for key, value in rows}


def _variety_names(ctx: RecipeContext) -> dict[Any, RiceVariety]:
    return {v.id: v for v in ctx.db.query(RiceVariety).all()}


def dry_cavan_cost(price_per_cavan: Decimal, moisture: Decimal | None) -> Decimal:
    """What a cavan of palay really costs once dried to 14%: wet palay loses
    water weight, so a cheap wet cavan can cost more than a dear dry one."""
    m = Decimal(moisture) if moisture is not None else SAFE_MOISTURE
    if m <= SAFE_MOISTURE:
        return Decimal(price_per_cavan)
    return Decimal(price_per_cavan) / ((100 - m) / (100 - SAFE_MOISTURE))


def variety_economics(ctx: RecipeContext, days: int = 30) -> list[dict[str, Any]]:
    """Per variety over the last ``days``: stock, pace, prices, actual recovery,
    cost per kilo of rice, margin, and the candidate figures advice needs."""
    db, today = ctx.db, ctx.local_today
    since = today - timedelta(days=days)
    week = today - timedelta(days=7)
    start = datetime.combine(since, time(0, 0), tzinfo=ctx.zone)
    varieties = _variety_names(ctx)

    palay_stock = _pairs(
        db.query(PalayInventory.variety_id, func.sum(PalayInventory.quantity_kg)).group_by(PalayInventory.variety_id)
    )
    rice_stock = _pairs(
        db.query(MilledRiceInventory.variety_id, func.sum(MilledRiceInventory.quantity_kg)).group_by(
            MilledRiceInventory.variety_id
        )
    )
    batch_ok = (MillingBatch.status == "completed", MillingBatch.start_datetime >= start)
    milled_in = _pairs(
        db.query(MillingBatchInput.variety_id, func.sum(MillingBatchInput.input_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchInput.batch_id)
        .filter(*batch_ok)
        .group_by(MillingBatchInput.variety_id)
    )
    milled_out = _pairs(
        db.query(MillingBatchOutput.variety_id, func.sum(MillingBatchOutput.output_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchOutput.batch_id)
        .filter(MillingBatchOutput.output_type == "milled_rice", *batch_ok)
        .group_by(MillingBatchOutput.variety_id)
    )
    net = PalayPurchaseItem.gross_weight_kg - PalayPurchaseItem.tare_weight_kg
    bought = {
        vid: (kg_, cost, moist)
        for vid, kg_, cost, moist in db.query(
            PalayPurchaseItem.variety_id,
            func.sum(net),
            func.sum(net / KG_PER_CAVAN * PalayPurchaseItem.price_per_cavan),
            func.sum(net * PalayPurchaseItem.moisture_content_pct) / func.nullif(func.sum(net), 0),
        )
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(PalayPurchase.purchase_date >= since, PalayPurchase.status != "cancelled")
        .group_by(PalayPurchaseItem.variety_id)
    }
    week_price = _pairs(
        db.query(
            PalayPurchaseItem.variety_id,
            func.sum(net / KG_PER_CAVAN * PalayPurchaseItem.price_per_cavan)
            / func.nullif(func.sum(net / KG_PER_CAVAN), 0),
        )
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(PalayPurchase.purchase_date >= week, PalayPurchase.status != "cancelled")
        .group_by(PalayPurchaseItem.variety_id)
    )
    sold = {
        vid: (q, amt)
        for vid, q, amt in db.query(
            SalesOrderItem.variety_id,
            func.sum(SalesOrderItem.quantity_kg),
            func.sum(SalesOrderItem.quantity_kg * SalesOrderItem.unit_price_per_kg),
        )
        .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id)
        .filter(
            SalesOrderItem.item_type == "milled_rice",
            SalesOrder.order_date >= since,
            SalesOrder.status.notin_(("draft", "cancelled")),
        )
        .group_by(SalesOrderItem.variety_id)
    }
    # Costs per kilo of rice made, spread over all varieties.
    rice_made = sum((Decimal(v or 0) for v in milled_out.values()), D0)
    production = (
        db.query(func.sum(Expense.amount))
        .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .filter(Expense.expense_date >= since, ExpenseCategory.is_production_cost.is_(True))
        .scalar()
    )
    drying = db.query(func.sum(DryingRecord.drying_cost)).filter(DryingRecord.start_datetime >= start).scalar()
    byproducts = (
        db.query(func.sum(SalesOrderItem.quantity_kg * SalesOrderItem.unit_price_per_kg))
        .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id)
        .filter(
            SalesOrderItem.item_type == "byproduct",
            SalesOrder.order_date >= since,
            SalesOrder.status.notin_(("draft", "cancelled")),
        )
        .scalar()
    )
    per_kg = lambda total: Decimal(total or 0) / rice_made if rice_made else D0  # noqa: E731
    overhead_kg, drying_kg, byproduct_kg = per_kg(production), per_kg(drying), per_kg(byproducts)
    prices = db.query(PriceList).filter(PriceList.is_active.is_(True)).all()

    rows = []
    for vid in {*palay_stock, *rice_stock, *milled_in, *bought, *sold} - {None}:
        v = varieties.get(vid)
        if v is None:
            continue
        palay_kg = Decimal(palay_stock.get(vid) or 0)
        rice_kg = Decimal(rice_stock.get(vid) or 0)
        milled_per_day = Decimal(milled_in.get(vid) or 0) / days
        sold_kg, sold_amt = (Decimal(x or 0) for x in sold.get(vid, (0, 0)))
        sold_per_day = sold_kg / days
        bought_kg, bought_cost, moisture = bought.get(vid, (0, 0, None))
        price_cavan = Decimal(bought_cost or 0) / (Decimal(bought_kg) / KG_PER_CAVAN) if bought_kg else None
        actual_recovery = (
            Decimal(milled_out.get(vid) or 0) / Decimal(milled_in[vid]) * 100 if milled_in.get(vid) else None
        )
        recovery = actual_recovery or Decimal(v.typical_recovery_pct or DEFAULT_RECOVERY)
        selling = sold_amt / sold_kg if sold_kg else None
        listed = list_price(prices, vid, "A", None, today) or list_price(prices, vid, None, None, today)
        row: dict[str, Any] = {
            "variety": v.name,
            "palay_in_stock_kg": _n(palay_kg),
            "palay_milled_per_day_kg": _n(milled_per_day),
            "days_of_palay_left": _n(palay_kg / milled_per_day, 1) if milled_per_day else None,
            "rice_in_stock_kg": _n(rice_kg),
            "rice_sold_per_day_kg": _n(sold_per_day),
            "days_of_rice_left": _n(rice_kg / sold_per_day, 1) if sold_per_day else None,
            "recovery_pct_actual": _n(actual_recovery, 1) if actual_recovery else None,
            "recovery_pct_typical": _n(v.typical_recovery_pct, 1) if v.typical_recovery_pct else None,
        }
        if milled_per_day:
            for horizon in (7, 14):
                need = max(D0, milled_per_day * horizon - palay_kg)
                row[f"palay_to_buy_for_{horizon}_days_kg"] = _n(need)
                row[f"palay_to_buy_for_{horizon}_days_cavans"] = _n(need / KG_PER_CAVAN)
        if price_cavan is not None:
            row["palay_price_per_cavan_30d"] = _n(price_cavan)
            if week_price.get(vid):
                row["palay_price_per_cavan_7d"] = _n(week_price[vid])
                row["palay_price_change_7d_vs_30d_pct"] = _change(week_price[vid], price_cavan)
            row["palay_moisture_pct_avg"] = _n(moisture, 1) if moisture is not None else None
            dry_cost = dry_cavan_cost(price_cavan, moisture)
            row["palay_cost_per_dry_cavan"] = _n(dry_cost)
            rice_cost = dry_cost / KG_PER_CAVAN / (recovery / 100)
            row["palay_cost_per_kg_of_rice"] = _n(rice_cost, 2)
            cost_kg = rice_cost + overhead_kg + drying_kg - byproduct_kg
            row["full_cost_per_kg_of_rice"] = _n(cost_kg, 2)
            if selling:
                margin = selling - cost_kg
                row["selling_price_per_kg_avg"] = _n(selling, 2)
                row["margin_per_kg"] = _n(margin, 2)
                row["margin_pct_of_price"] = _n(margin / selling * 100, 1)
                row["gross_margin_30d"] = _n(margin * sold_kg)
                # Candidate figures: the dearest palay that still leaves ₱2/kg,
                # and the price that would earn ₱3/kg at today's palay cost.
                ceiling = (selling - 2 - overhead_kg - drying_kg + byproduct_kg) * (recovery / 100) * KG_PER_CAVAN
                row["highest_dry_cavan_price_for_2_peso_margin"] = _n(ceiling)
                row["selling_price_for_3_peso_margin"] = _n(cost_kg + 3, 2)
        if listed is not None:
            row["price_list_per_kg"] = _n(listed, 2)
        rows.append(row)
    return sorted(rows, key=lambda r: r["variety"])


def overhead_facts(ctx: RecipeContext, days: int = 30) -> dict[str, Any]:
    """The per-kilo costs variety_economics spreads, for the model to cite."""
    since = ctx.local_today - timedelta(days=days)
    start = datetime.combine(since, time(0, 0), tzinfo=ctx.zone)
    rice_made = (
        ctx.db.query(func.sum(MillingBatchOutput.output_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchOutput.batch_id)
        .filter(MillingBatchOutput.output_type == "milled_rice", MillingBatch.status == "completed")
        .filter(MillingBatch.start_datetime >= start)
        .scalar()
    )
    return {"rice_milled_last_30_days_kg": _n(rice_made), "period_days": days}


# ── 1. AI morning briefing (with the day's alerts sorted) ────────────────────


class BriefingParams(BaseModel):
    send_at: str = "06:15"
    email: bool = True

    @field_validator("send_at")
    @classmethod
    def _morning(cls, value: str) -> str:
        try:
            parsed = time.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Use a time like 06:15") from exc
        if not time(4, 0) <= parsed < time(12, 0):
            raise ValueError("Pick a time between 04:00 and 11:59")
        return parsed.strftime("%H:%M")


def _briefing_schedule(params: BaseModel) -> Schedule:
    assert isinstance(params, BriefingParams)
    at = time.fromisoformat(params.send_at)

    def due(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        return local.date().isoformat() if at <= local.time() < time(12, 0) else None

    return due


def recent_alerts(ctx: RecipeContext, hours: int = 24) -> list[str]:
    """The rule-based recipes' alert titles from the last ``hours``. Titles
    only: recipes write them from figures and names, while bodies can quote
    what users typed (an expense description)."""
    rows = (
        ctx.db.query(Notification.title, func.min(Notification.created_at))
        .filter(
            Notification.created_at >= ctx.now - timedelta(hours=hours),
            Notification.kind.like("automation.%"),
            Notification.kind.notlike("automation.ai\\_%"),
            Notification.dedupe_key.notlike("%:test:%"),
        )
        .group_by(Notification.title)
        .order_by(func.min(Notification.created_at))
        .limit(30)
        .all()
    )
    return [title for title, _ in rows]


def _briefing(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    db, today = ctx.db, ctx.local_today
    yesterday = today - timedelta(days=1)
    y = week_totals(ctx, yesterday, yesterday)
    w = week_totals(ctx, today - timedelta(days=8), today - timedelta(days=2))  # the 7 days before
    avg = {k: v / 7 for k, v in w.items() if k != "recovery"}
    due_today = (
        db.query(Invoice)
        .filter(Invoice.status.in_(credit.OPEN_INVOICE), func.coalesce(Invoice.due_date, Invoice.invoice_date) == today)
        .all()
    )
    overdue = db.query(Invoice).filter(Invoice.status == "overdue").all()
    owed: dict[str, Decimal] = defaultdict(Decimal)
    for inv in overdue:
        owed[inv.customer.name if inv.customer else "Walk-in"] += Decimal(inv.total_amount - inv.paid_amount)
    deliveries = (
        db.query(SalesOrder)
        .filter(SalesOrder.delivery_date == today, SalesOrder.delivered_at.is_(None))
        .filter(SalesOrder.status.notin_(("draft", "cancelled", "delivered")))
        .all()
    )
    low = [
        {"variety": r["variety"], "days_of_rice_left": r["days_of_rice_left"]}
        for r in variety_economics(ctx)
        if r.get("days_of_rice_left") is not None and r["days_of_rice_left"] < 7
    ]
    drying = db.query(DryingRecord.id).filter(DryingRecord.purchase_item_id == PalayPurchaseItem.id).exists()
    wet = (
        db.query(PalayPurchaseItem, PalayPurchase)
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(
            PalayPurchase.status != "cancelled",
            PalayPurchaseItem.moisture_content_pct > 16,
            PalayPurchase.created_at >= ctx.now - timedelta(days=3),
            ~drying,
        )
        .all()
    )
    open_batches = (
        db.query(MillingBatch)
        .filter(MillingBatch.status == "in_progress", MillingBatch.start_datetime <= ctx.now - timedelta(hours=12))
        .all()
    )
    facts = {
        "yesterday": {
            "date": f"{yesterday:%A %d %B}",
            "palay_bought_kg": _n(y["palay_kg"]),
            "palay_bought_php": _n(y["palay_cost"]),
            "rice_milled_kg": _n(y["milled_kg"]),
            "recovery_pct": _n(y["recovery"], 1) if y["recovery"] else None,
            "sales_php": _n(y["sales"]),
            "collected_php": _n(y["collected"]),
            "expenses_php": _n(y["expenses"]),
        },
        "daily_average_over_the_7_days_before": {
            "palay_bought_kg": _n(avg["palay_kg"]),
            "rice_milled_kg": _n(avg["milled_kg"]),
            "sales_php": _n(avg["sales"]),
            "collected_php": _n(avg["collected"]),
            "expenses_php": _n(avg["expenses"]),
        },
        "yesterday_vs_that_average_pct": {
            "sales": _change(y["sales"], avg["sales"]),
            "collected": _change(y["collected"], avg["collected"]),
            "rice_milled": _change(y["milled_kg"], avg["milled_kg"]),
            "palay_bought": _change(y["palay_kg"], avg["palay_kg"]),
        },
        "today": {
            "invoices_due_today": [
                {
                    "customer": i.customer.name if i.customer else "Walk-in",
                    "invoice": i.invoice_no,
                    "php": _n(i.total_amount - i.paid_amount),
                }
                for i in sorted(due_today, key=lambda i: -(i.total_amount - i.paid_amount))[:5]
            ],
            "overdue_total_php": _n(sum(owed.values(), D0)),
            "biggest_overdue_customers": [
                {"customer": name, "php": _n(amount)}
                for name, amount in sorted(owed.items(), key=lambda kv: -kv[1])[:3]
            ],
            "deliveries_due_today_count": len(deliveries),
            "deliveries_due_today": [
                {"order": o.order_no, "customer": o.customer.name if o.customer else "Walk-in"} for o in deliveries[:5]
            ],
            "rice_running_low": low,
            "wet_palay_not_yet_drying": [
                {
                    "lot": p.reference_no,
                    "kg": _n(Decimal(i.gross_weight_kg) - Decimal(i.tare_weight_kg)),
                    "moisture_pct": _n(i.moisture_content_pct, 1),
                    "hours_waiting": max(0, int((ctx.now - p.created_at).total_seconds() // 3600)),
                }
                for i, p in wet
            ],
            "milling_batches_left_open": [
                {"batch": b.batch_no, "hours_open": int((ctx.now - b.start_datetime).total_seconds() // 3600)}
                for b in open_batches
            ],
        },
        "alerts_in_the_last_24_hours": recent_alerts(ctx),
    }
    figures = [
        f"Yesterday: sales {peso(y['sales'])}, collected {peso(y['collected'])}, expenses {peso(y['expenses'])}",
        f"Palay bought {kg(y['palay_kg'])} for {peso(y['palay_cost'])}; rice milled {kg(y['milled_kg'])}",
        f"Overdue: {peso(sum(owed.values(), D0))} across {len(owed)} customer(s)",
    ]
    alerts = facts["alerts_in_the_last_24_hours"]
    if isinstance(alerts, list) and alerts:
        figures.append(f"Alerts in the last 24 hours: {len(alerts)}")
    task = (
        "Write the owner's morning briefing. Say how yesterday went against the usual day, in two or three "
        "sentences. Then pick up to three things to do first today from the 'today' facts and the alerts: "
        "the ones that cost or bring the most money, or spoil if left (wet palay, a delivery, a big overdue "
        "customer). If several alerts point to one problem, say so once. Ignore alerts that need no action."
    )
    keys = (
        HEADLINE,
        ai.Key("summary", "two or three sentences on yesterday against the usual day", limit=500),
        ai.Key(
            "today",
            "what to do first today, most important first, each with the reason",
            limit=200,
            is_list=True,
            max_items=3,
        ),
    )
    return [
        advise(
            ctx,
            title=f"Your morning briefing ({today:%a %d %b})",
            dedupe_key=f"ai_briefing:{today.isoformat()}",
            link="/automations",
            task=task,
            facts=facts,
            figures=figures,
            keys=keys,
            render=_render(("summary", ""), ("today", "First today:")),
        )
    ]


AI_BRIEFING = Recipe(
    code="ai_briefing",
    title="Morning briefing",
    description=(
        "Each morning, yesterday against a usual day in a few plain sentences, and the three things to do "
        "first today, picked from what's due and from the alerts."
    ),
    group="advisor",
    section="reports",
    default_roles=("owner",),
    params=BriefingParams,
    fields=(Field("send_at", "Send at", "time", "Your mill's local time, before noon."), EMAIL_FIELD),
    schedule=_briefing_schedule,
    build=_briefing,
    uses_ai=True,
)


# ── 2. payment reminder drafts ───────────────────────────────────────────────

MAX_CUSTOMERS = 8


def _collection_drafts(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    today = ctx.local_today
    overdue = (
        ctx.db.query(Invoice)
        .filter(Invoice.status == "overdue", Invoice.customer_id.isnot(None))
        .order_by(func.coalesce(Invoice.due_date, Invoice.invoice_date))
        .all()
    )
    by_customer: dict[Any, list[Invoice]] = defaultdict(list)
    for inv in overdue:
        if inv.total_amount > inv.paid_amount:
            by_customer[inv.customer_id].append(inv)
    if not by_customer:
        return []
    ranked = sorted(by_customer.values(), key=lambda invs: -sum(i.total_amount - i.paid_amount for i in invs))
    customers, lookup = [], {}
    for n, invoices in enumerate(ranked[:MAX_CUSTOMERS], start=1):
        customer = invoices[0].customer
        ref = f"C{n}"
        lookup[ref] = customer
        last_paid = (
            ctx.db.query(func.max(Payment.payment_date))
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .filter(Invoice.customer_id == customer.id)
            .scalar()
        )
        customers.append(
            {
                "ref": ref,
                "name": customer.name,
                "kind": customer.customer_type,
                "overdue_php": _n(sum(i.total_amount - i.paid_amount for i in invoices)),
                "overdue_invoice_count": len(invoices),
                "oldest_invoices": [
                    {
                        "invoice": i.invoice_no,
                        "balance_php": _n(i.total_amount - i.paid_amount),
                        "was_due": f"{(i.due_date or i.invoice_date):%d %B}",
                        "days_late": (today - (i.due_date or i.invoice_date)).days,
                    }
                    for i in invoices[:4]
                ],
                "last_payment": f"{last_paid:%d %B}" if last_paid else None,
            }
        )
    task = (
        "Write one text message per customer that the mill can send by SMS or Messenger to ask for payment. "
        "Warm and respectful, as Filipino business people write to customers they want to keep; firmer and "
        "more direct the longer and larger the debt. Address the customer by name, give the total overdue "
        "and how many invoices it covers; name an invoice number only when there are one or two. Ask for "
        "payment or a date they can pay. Sign off with the mill's name. Keep each under 320 characters, so "
        "it fits in two text messages."
    )
    keys = (
        ai.Key(
            "messages",
            "one message per customer, each starting with the customer's ref and a colon, e.g. 'C1: ...'",
            limit=400,
            is_list=True,
            max_items=MAX_CUSTOMERS,
        ),
    )

    def render(answer: dict[str, Any]) -> list[str]:
        lines = ["Ready-to-send reminders. Read each one before you send it."]
        for message in answer.get("messages", []):
            ref, _, text = message.partition(":")
            customer = lookup.get(ref.strip())
            if customer is None or not text.strip():
                continue
            phone = f" ({customer.phone})" if customer.phone else ""
            lines += ["", f"To {customer.name}{phone}:", text.strip()]
        return lines if len(lines) > 1 else []

    return [
        advise(
            ctx,
            title=f"Payment reminders ready to send: {len(customers)}",
            dedupe_key=f"ai_collection_drafts:{today.isoformat()}",
            link="/sales",
            task=task,
            facts={"overdue_customers": customers},
            figures=[
                f"{invoices[0].customer.name}: {peso(sum(i.total_amount - i.paid_amount for i in invoices))} overdue"
                for invoices in ranked[:MAX_CUSTOMERS]
            ],
            keys=keys,
            render=render,
        )
    ]


AI_COLLECTION_DRAFTS = Recipe(
    code="ai_collection_drafts",
    title="Payment reminder drafts",
    description=(
        "Monday and Thursday mornings, a polite text message for each customer with overdue invoices, "
        "written in your language and ready to send."
    ),
    group="advisor",
    section="sales",
    default_roles=("accountant", "owner"),
    params=_EmailOnly,
    fields=(EMAIL_FIELD,),
    schedule=lambda _p: daily(time(8, 30), days=frozenset({0, 3})),
    build=_collection_drafts,
    uses_ai=True,
)


# ── 3. palay buying advisor ──────────────────────────────────────────────────


def supplier_prices(ctx: RecipeContext, days: int = 30) -> list[dict[str, Any]]:
    """Per supplier: what their palay really cost once dried, against the mill's average."""
    since = ctx.local_today - timedelta(days=days)
    net = PalayPurchaseItem.gross_weight_kg - PalayPurchaseItem.tare_weight_kg
    rows = (
        ctx.db.query(Supplier.name, PalayPurchaseItem.price_per_cavan, PalayPurchaseItem.moisture_content_pct, net)
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .join(Supplier, Supplier.id == PalayPurchase.supplier_id)
        .filter(PalayPurchase.purchase_date >= since, PalayPurchase.status != "cancelled")
        .all()
    )
    agg: dict[str, list[Decimal]] = defaultdict(lambda: [D0, D0, D0, D0])
    for name, price, moisture, weight in rows:
        cavans = Decimal(weight) / KG_PER_CAVAN
        a = agg[name]
        a[0] += Decimal(weight)
        a[1] += cavans * Decimal(price)
        a[2] += cavans * dry_cavan_cost(Decimal(price), moisture)
        a[3] += Decimal(weight) * Decimal(moisture or SAFE_MOISTURE)
    total_cavans = sum((a[0] for a in agg.values()), D0) / KG_PER_CAVAN
    mill_dry = sum((a[2] for a in agg.values()), D0) / total_cavans if total_cavans else D0
    out = []
    for name, (weight, cost, dry_cost, moist) in sorted(agg.items(), key=lambda kv: -kv[1][0]):
        cavans = weight / KG_PER_CAVAN
        dry = dry_cost / cavans
        out.append(
            {
                "supplier": name,
                "palay_bought_kg": _n(weight),
                "price_per_cavan_avg": _n(cost / cavans),
                "moisture_pct_avg": _n(moist / weight, 1),
                "cost_per_dry_cavan": _n(dry),
                "vs_mill_average_dry_cost_pct": _change(dry, mill_dry),
            }
        )
    return out


def _buying_advisor(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    varieties = [r for r in variety_economics(ctx) if r.get("palay_milled_per_day_kg")]
    if not varieties:
        return []
    facts = {
        "month": f"{ctx.local_today:%B}",
        "varieties": varieties,
        "suppliers_last_30_days": supplier_prices(ctx),
        "notes": (
            "cost_per_dry_cavan is the price once the palay is dried to 14% moisture. "
            "highest_dry_cavan_price_for_2_peso_margin is the most the mill can pay per dry cavan and still "
            "keep ₱2 a kilo of rice at its current selling price."
        ),
    }
    task = (
        "Advise the owner on buying palay this week. For each variety worth acting on, say how much to buy "
        "(use the palay_to_buy figures) and the most to pay (use highest_dry_cavan_price_for_2_peso_margin, "
        "and remember wet palay costs more once dried). Then say which suppliers have been good value and "
        "which dear, using cost_per_dry_cavan. Mention the time of year only if it matters for the Philippine "
        "harvest. Skip varieties with plenty of stock."
    )
    keys = (
        HEADLINE,
        ai.Key(
            "buy",
            "per variety: how much to buy this week and the most to pay, with the reason",
            limit=300,
            is_list=True,
            max_items=4,
        ),
        ai.Key("suppliers", "which suppliers have been good value and which dear, and why", limit=400),
        ai.Key("caution", "the one thing in the figures that should make the owner careful, if any", limit=300),
    )
    figures = []
    for v in varieties:
        left = f" (about {v['days_of_palay_left']:g} days)" if v.get("days_of_palay_left") is not None else ""
        price = f", paid {peso(v['palay_price_per_cavan_30d'])} a cavan" if v.get("palay_price_per_cavan_30d") else ""
        figures.append(f"{v['variety']}: {kg(v['palay_in_stock_kg'])} of palay{left}{price}")
    return [
        advise(
            ctx,
            title=f"Palay buying advice, week of {ctx.local_today:%d %b}",
            dedupe_key=f"ai_buying_advisor:{ctx.local_today.isoformat()}",
            link="/paddy",
            task=task,
            facts=facts,
            figures=figures,
            keys=keys,
            render=_render(("buy", "This week:"), ("suppliers", "Suppliers:"), ("caution", "Be careful:")),
        )
    ]


AI_BUYING_ADVISOR = Recipe(
    code="ai_buying_advisor",
    title="Palay buying advisor",
    description=(
        "Monday mornings, how much palay of each variety to buy this week, the most to pay once drying is "
        "counted, and which suppliers have been good value."
    ),
    group="advisor",
    section="paddy",
    default_roles=("owner",),
    params=_EmailOnly,
    fields=(EMAIL_FIELD,),
    schedule=lambda _p: weekly(MONDAY, time(6, 30)),
    build=_buying_advisor,
    uses_ai=True,
)


# ── 4. leakage watch ─────────────────────────────────────────────────────────

LEAK_DAYS = 28


def leakage_signals(ctx: RecipeContext, days: int = LEAK_DAYS) -> dict[str, Any]:
    """Who did what over the period, set against everyone else: the raw
    material for spotting money quietly leaking. Nothing here is a finding by
    itself; most differences have an innocent reason."""
    db, today = ctx.db, ctx.local_today
    since = today - timedelta(days=days)
    start = datetime.combine(since, time(0, 0), tzinfo=ctx.zone)
    users = {u.id: u.full_name or u.username for u in db.query(User).filter(User.company_id == ctx.company.id)}
    who = lambda uid: users.get(uid, "someone no longer on the team") if uid else "unrecorded"  # noqa: E731
    varieties = _variety_names(ctx)

    # Palay prices by who entered the purchase and from whom, against the
    # variety's average for the period, and the moisture they bought at.
    net = PalayPurchaseItem.gross_weight_kg - PalayPurchaseItem.tare_weight_kg
    items = (
        db.query(
            PalayPurchase.created_by,
            Supplier.name,
            PalayPurchaseItem.variety_id,
            PalayPurchaseItem.price_per_cavan,
            PalayPurchaseItem.moisture_content_pct,
            net,
        )
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .outerjoin(Supplier, Supplier.id == PalayPurchase.supplier_id)
        .filter(PalayPurchase.purchase_date >= since, PalayPurchase.status != "cancelled")
        .all()
    )
    var_sum: dict[Any, list[Decimal]] = defaultdict(lambda: [D0, D0, D0])
    for _, _, vid, price, moisture, weight in items:
        w = Decimal(weight)
        var_sum[vid][0] += w
        var_sum[vid][1] += w * Decimal(price)
        var_sum[vid][2] += w * Decimal(moisture or SAFE_MOISTURE)
    pairs: dict[tuple, list[Decimal]] = defaultdict(lambda: [D0, D0, D0, D0, D0])
    for by, supplier, vid, price, moisture, weight in items:
        w = Decimal(weight)
        avg_price = var_sum[vid][1] / var_sum[vid][0]
        avg_moist = var_sum[vid][2] / var_sum[vid][0]
        p = pairs[(who(by), supplier or "no supplier")]
        p[0] += 1
        p[1] += w
        p[2] += w * (Decimal(price) - avg_price) / avg_price * 100  # premium over the variety average
        p[3] += w * (Decimal(moisture or SAFE_MOISTURE) - avg_moist)  # wetter (+) or drier than average
        p[4] += w / KG_PER_CAVAN * (Decimal(price) - avg_price)  # pesos paid over the average
    purchases = [
        {
            "entered_by": by,
            "supplier": supplier,
            "purchases": int(p[0]),
            "palay_kg": _n(p[1]),
            "price_vs_variety_average_pct": _n(p[2] / p[1], 1),
            "moisture_vs_variety_average_points": _n(p[3] / p[1], 1),
            "paid_over_variety_average_php": _n(p[4]),
        }
        for (by, supplier), p in pairs.items()
        if p[0] >= 2
    ]
    purchases.sort(key=lambda r: -abs(r["paid_over_variety_average_php"]))

    # Sales: discounts and prices under the list, by who entered them and for whom.
    prices = db.query(PriceList).filter(PriceList.is_active.is_(True)).all()
    lines = (
        db.query(SalesOrder, SalesOrderItem, Customer.name, Customer.customer_type)
        .join(SalesOrderItem, SalesOrderItem.order_id == SalesOrder.id)
        .outerjoin(Customer, Customer.id == SalesOrder.customer_id)
        .filter(SalesOrder.order_date >= since, SalesOrder.status.notin_(("draft", "cancelled")))
        .all()
    )
    staff: dict[str, list[Decimal]] = defaultdict(lambda: [D0, D0, D0, D0])
    buyers: dict[str, list[Decimal]] = defaultdict(lambda: [D0, D0, D0])
    buyer_staff: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    seen_orders: set = set()
    for order, item, customer, ctype in lines:
        name, customer = who(order.created_by), customer or "walk-in"
        if order.id not in seen_orders:
            seen_orders.add(order.id)
            staff[name][0] += Decimal(order.total_amount or 0)
            staff[name][1] += Decimal(order.discount_amount or 0)
            buyers[customer][0] += Decimal(order.total_amount or 0)
            buyers[customer][1] += Decimal(order.discount_amount or 0)
            if order.discount_amount:
                buyer_staff[customer][name] += Decimal(order.discount_amount)
        if item.item_type == "milled_rice" and item.variety_id:
            listed = list_price(prices, item.variety_id, item.grade_name, ctype, order.order_date)
            if listed is not None and Decimal(item.unit_price_per_kg) < listed:
                under = (listed - Decimal(item.unit_price_per_kg)) * Decimal(item.quantity_kg)
                staff[name][2] += under
                staff[name][3] += 1
                buyers[customer][2] += under
                buyer_staff[customer][name] += under
    sales_by_staff = [
        {
            "entered_by": name,
            "sales_php": _n(s[0]),
            "discounts_php": _n(s[1]),
            "under_price_list_php": _n(s[2]),
            "lines_under_price_list": int(s[3]),
            "given_away_pct_of_sales": _n((s[1] + s[2]) / s[0] * 100, 1) if s[0] else None,
        }
        for name, s in staff.items()
    ]
    given_away_by_customer = [
        {
            "customer": customer,
            "sales_php": _n(b[0]),
            "discounts_php": _n(b[1]),
            "under_price_list_php": _n(b[2]),
            "given_away_pct_of_sales": _n((b[1] + b[2]) / b[0] * 100, 1) if b[0] else None,
            "mostly_entered_by": max(buyer_staff[customer].items(), key=lambda kv: kv[1])[0]
            if buyer_staff[customer]
            else None,
        }
        for customer, b in sorted(buyers.items(), key=lambda kv: -(kv[1][1] + kv[1][2]))
        if b[1] + b[2] > 0
    ]

    # Milling by operator: recovery against what the varieties should give.
    batches = (
        db.query(MillingBatch).filter(MillingBatch.status == "completed", MillingBatch.start_datetime >= start).all()
    )
    ops: dict[str, list[Decimal]] = defaultdict(lambda: [D0, D0, D0, D0, D0])
    for b in batches:
        inputs = db.query(MillingBatchInput).filter(MillingBatchInput.batch_id == b.id).all()
        rice = (
            db.query(func.sum(MillingBatchOutput.output_weight_kg), func.avg(MillingBatchOutput.broken_rice_pct))
            .filter(MillingBatchOutput.batch_id == b.id, MillingBatchOutput.output_type == "milled_rice")
            .one()
        )
        input_kg = sum((Decimal(i.input_weight_kg) for i in inputs), D0)
        if not input_kg or rice[0] is None:
            continue
        expected = sum(
            (
                Decimal(i.input_weight_kg)
                * Decimal(
                    (varieties[i.variety_id].typical_recovery_pct if i.variety_id in varieties else None)
                    or DEFAULT_RECOVERY
                )
                / 100
                for i in inputs
            ),
            D0,
        )
        o = ops[who(b.operator_id)]
        o[0] += 1
        o[1] += input_kg
        o[2] += Decimal(rice[0])
        o[3] += expected
        o[4] += Decimal(rice[1] or 0)
    rice_prices = [r for r in (variety_economics(ctx) or []) if r.get("selling_price_per_kg_avg")]
    avg_rice_price = (
        sum((Decimal(str(r["selling_price_per_kg_avg"])) for r in rice_prices), D0) / len(rice_prices)
        if rice_prices
        else None
    )
    milling = [
        {
            "operator": name,
            "batches": int(o[0]),
            "palay_milled_kg": _n(o[1]),
            "recovery_pct": _n(o[2] / o[1] * 100, 1),
            "expected_recovery_pct": _n(o[3] / o[1] * 100, 1),
            "rice_short_of_expected_kg": _n(o[3] - o[2]),
            "rice_short_value_php": _n((o[3] - o[2]) * avg_rice_price) if avg_rice_price else None,
            "broken_pct_avg": _n(o[4] / o[0], 1),
        }
        for name, o in ops.items()
    ]

    # Edits to old records, and stock adjustments, by person.
    logs = (
        db.query(ActivityLog)
        .filter(ActivityLog.created_at >= start, ActivityLog.detail.like("status=2%"))
        .filter(ActivityLog.action.in_(("api.put", "api.patch", "api.delete", "api.post")))
        .all()
    )
    late_edits: dict[str, int] = defaultdict(int)
    adjustments: dict[str, int] = defaultdict(int)
    for log in logs:
        label = log.entity_label or ""
        if log.action == "api.post":
            if label == "/api/inventory/adjust":
                adjustments[who(log.user_id)] += 1
            continue
        for pattern, model, *_ in _EDITABLE:
            match = pattern.match(label)
            if match:
                record_id = uuid.UUID(match.group(1))
                record: PalayPurchase | SalesOrder | None = (
                    db.get(PalayPurchase, record_id) if model is PalayPurchase else db.get(SalesOrder, record_id)
                )
                if (
                    record is not None
                    and record.created_at
                    and log.created_at - record.created_at >= timedelta(hours=24)
                ):
                    late_edits[who(log.user_id)] += 1
                break

    # Cash: who took it, and cash's share of collections against the period before.
    def cash_share(a: date, b: date) -> tuple[Decimal, Decimal]:
        total, cash = (
            db.query(func.sum(Payment.amount), func.sum(Payment.amount).filter(Payment.method == "cash"))
            .filter(Payment.payment_date >= a, Payment.payment_date < b)
            .one()
        )
        return Decimal(total or 0), Decimal(cash or 0)

    now_total, now_cash = cash_share(since, today + timedelta(days=1))
    before_total, before_cash = cash_share(since - timedelta(days=days), since)
    cash_by_person = (
        db.query(Payment.received_by, func.count(Payment.id), func.sum(Payment.amount))
        .filter(Payment.payment_date >= since, Payment.method == "cash")
        .group_by(Payment.received_by)
        .all()
    )
    return {
        "period_days": days,
        "palay_purchases_by_who_entered_and_supplier": purchases[:12],
        "sales_by_who_entered": sales_by_staff,
        "customers_given_discounts_or_under_list_prices": given_away_by_customer[:8],
        "milling_by_operator": milling,
        "edits_to_records_over_a_day_old_by_person": dict(late_edits),
        "stock_adjustments_by_person": dict(adjustments),
        "cash": {
            "cash_share_of_collections_pct": _n(now_cash / now_total * 100, 1) if now_total else None,
            "cash_share_previous_period_pct": _n(before_cash / before_total * 100, 1) if before_total else None,
            "cash_received_by_person": [
                {"person": who(uid), "payments": count, "php": _n(amount)} for uid, count, amount in cash_by_person
            ],
        },
    }


def _leakage_watch(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    signals = leakage_signals(ctx)
    task = (
        "You are a careful internal auditor for the owner. Look across these signals for patterns where money "
        "may be quietly leaking: one person paying one supplier more than everyone else pays for the same "
        "variety (especially for wetter palay), discounts or prices under the list concentrated on one "
        "customer or entered by one person, one operator's batches yielding less rice than expected, repeated "
        "stock adjustments or edits to old records by one person, cash handling that changed. Report at most "
        "four patterns, biggest peso effect first. For each, say what you see, who and what is involved, the "
        "peso amount, and the simplest way for the owner to check it (which records to look at, whom to ask). "
        "Most differences have an innocent explanation (better palay, a loyal customer, a worn machine): never "
        "accuse anyone, and mention the innocent explanation. If nothing stands out, say so."
    )
    keys = (
        HEADLINE,
        ai.Key("patterns", "patterns worth checking, biggest peso effect first", limit=500, is_list=True, max_items=4),
        ai.Key("all_clear", "one sentence on what looks normal", limit=250),
    )
    figures = []
    for p in signals["palay_purchases_by_who_entered_and_supplier"][:3]:
        figures.append(
            f"Palay from {p['supplier']} entered by {p['entered_by']}: {p['price_vs_variety_average_pct']:+g}% "
            f"against the variety average ({peso(p['paid_over_variety_average_php'])})"
        )
    for m in signals["milling_by_operator"]:
        figures.append(
            f"Milling by {m['operator']}: {m['recovery_pct']:g}% recovery, {m['expected_recovery_pct']:g}% expected"
        )
    for c in signals["customers_given_discounts_or_under_list_prices"][:2]:
        figures.append(
            f"{c['customer']}: {peso(c['discounts_php'])} in discounts, {peso(c['under_price_list_php'])} under the price list"
        )
    return [
        advise(
            ctx,
            title=f"Leakage watch: the last {LEAK_DAYS} days",
            dedupe_key=f"ai_leakage_watch:{ctx.local_today.isoformat()}",
            link="/reports",
            task=task,
            facts=signals,
            figures=figures,
            keys=keys,
            render=_render(("patterns", "Worth checking:"), ("all_clear", "")),
        )
    ]


AI_LEAKAGE_WATCH = Recipe(
    code="ai_leakage_watch",
    title="Leakage watch",
    description=(
        "Monday mornings, patterns where money may be quietly leaking: palay bought dear from one supplier, "
        "discounts clustered on one customer, an operator's batches yielding less, repeated stock adjustments. "
        "Never an accusation: what to check, and how."
    ),
    group="advisor",
    section="reports",
    default_roles=("owner",),
    params=_EmailOnly,
    fields=(EMAIL_FIELD,),
    schedule=lambda _p: weekly(MONDAY, time(8, 15)),
    build=_leakage_watch,
    uses_ai=True,
)


# ── 5. margin and pricing check ──────────────────────────────────────────────


def _margin_check(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    rows = [r for r in variety_economics(ctx) if r.get("margin_per_kg") is not None]
    if not rows:
        return []
    facts = {
        "varieties": rows,
        **overhead_facts(ctx),
        "notes": (
            "full_cost_per_kg_of_rice counts the palay (dried, at actual recovery), drying, production "
            "expenses, less by-product sales, all per kilo of rice. margin_per_kg is the average selling price "
            "less that. selling_price_for_3_peso_margin is the price that would earn ₱3 a kilo."
        ),
    }
    task = (
        "Tell the owner what each variety really earns per kilo of rice after everything, which is weakest and "
        "why (palay too dear, recovery low, selling price low or under the price list), and what to change: a "
        "price to move to (use selling_price_for_3_peso_margin or price_list_per_kg), a palay price ceiling "
        "(use highest_dry_cavan_price_for_2_peso_margin), or the recovery to look into."
    )
    keys = (
        HEADLINE,
        ai.Key(
            "findings",
            "per variety, the margin per kilo and what drives it, weakest first",
            limit=300,
            is_list=True,
            max_items=4,
        ),
        ai.Key(
            "changes", "concrete price or buying changes, with the figure to use", limit=250, is_list=True, max_items=3
        ),
    )
    figures = [
        f"{r['variety']}: costs ₱{r['full_cost_per_kg_of_rice']:.2f}/kg all in, sells at "
        f"₱{r['selling_price_per_kg_avg']:.2f}, margin ₱{r['margin_per_kg']:.2f}/kg ({peso(r['gross_margin_30d'])} in 30 days)"
        for r in rows
    ]
    return [
        advise(
            ctx,
            title="What each variety really earns",
            dedupe_key=f"ai_margin_check:{ctx.local_today.isoformat()}",
            link="/reports",
            task=task,
            facts=facts,
            figures=figures,
            keys=keys,
            render=_render(("findings", ""), ("changes", "Consider:")),
        )
    ]


AI_MARGIN_CHECK = Recipe(
    code="ai_margin_check",
    title="Margin and pricing check",
    description=(
        "Monday mornings, what each variety earns per kilo after palay, drying and running costs, and the "
        "price or buying change that would help most."
    ),
    group="advisor",
    section="reports",
    default_roles=("owner",),
    params=_EmailOnly,
    fields=(EMAIL_FIELD,),
    schedule=lambda _p: weekly(MONDAY, time(7, 30)),
    build=_margin_check,
    uses_ai=True,
)


# ── 6. drying planner ────────────────────────────────────────────────────────


class DryingPlanParams(BaseModel):
    location_id: str = ""
    email: bool = True


def _drying_schedule(_params: BaseModel) -> Schedule:
    def due(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        return local.date().isoformat() if time(5, 30) <= local.time() < time(10, 0) else None

    return due


def _drying_planner(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, DryingPlanParams)
    finished = (
        ctx.db.query(DryingRecord.id)
        .filter(DryingRecord.purchase_item_id == PalayPurchaseItem.id, DryingRecord.end_datetime.isnot(None))
        .exists()
    )
    started = (
        ctx.db.query(DryingRecord.id)
        .filter(DryingRecord.purchase_item_id == PalayPurchaseItem.id, DryingRecord.end_datetime.is_(None))
        .exists()
    )
    rows = (
        ctx.db.query(PalayPurchaseItem, PalayPurchase, started)
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(
            PalayPurchase.status != "cancelled",
            PalayPurchaseItem.moisture_content_pct > SAFE_MOISTURE,
            PalayPurchase.created_at >= ctx.now - timedelta(days=7),
            ~finished,
        )
        .all()
    )
    if not rows:
        return []
    loc = _location(ctx, params.location_id)
    forecast = _forecast(float(loc.lat), float(loc.lon))
    lots: list[_DryingLot] = [
        {
            "lot": p.reference_no,
            "variety": item.variety.name if item.variety else None,
            "kg": _n(Decimal(item.gross_weight_kg) - Decimal(item.tare_weight_kg)),
            "moisture_pct": _n(item.moisture_content_pct, 1),
            "hours_since_bought": max(0, int((ctx.now - p.created_at).total_seconds() // 3600)),
            "drying_started": bool(is_drying),
        }
        # Moisture is filtered above SAFE_MOISTURE, so never None here; the column is nullable.
        for item, p, is_drying in sorted(
            rows, key=lambda r: (-Decimal(r[0].moisture_content_pct or 0), r[1].created_at)
        )
    ]
    weather = {
        "days": [
            {"date": d.get("date"), "condition": d.get("condition"), "rain_chance_pct": d.get("precip_pct")}
            for d in (forecast.get("daily") or [])[:3]
        ],
        "daytime_hours": [
            {"time": h.get("time"), "condition": h.get("condition"), "rain_chance_pct": h.get("precip_pct")}
            for h in (forecast.get("hourly") or [])
            if h.get("is_daytime")
        ][:14],
    }
    task = (
        "Plan the drying of these wet palay lots over the next three days. Wettest and longest-waiting lots "
        "first: palay over 18% moisture left more than a day starts to heat and yellow. Sun-dry only in dry "
        "daytime hours; when rain is likely, say to keep the palay covered or use the mechanical dryer if the "
        "mill has one. Palay is safe to store at 14%. Name the lots and the hours."
    )
    keys = (
        HEADLINE,
        ai.Key("plan", "what to dry when, lot by lot, around the rain", limit=260, is_list=True, max_items=5),
        ai.Key("warning", "the biggest risk to the palay this week, if any", limit=300),
    )
    figures = [
        f"{lot['lot']}: {kg(lot['kg'])} at {lot['moisture_pct']:g}% moisture, waiting {lot['hours_since_bought']} hours"
        + (", drying started" if lot["drying_started"] else "")
        for lot in lots
    ]
    return [
        advise(
            ctx,
            title=f"Drying plan for {loc.label}",
            dedupe_key=f"ai_drying_planner:{ctx.local_today.isoformat()}",
            link="/paddy",
            task=task,
            facts={"place": loc.label, "safe_storage_moisture_pct": 14, "wet_palay_lots": lots, "forecast": weather},
            figures=figures,
            keys=keys,
            render=_render(("plan", ""), ("warning", "Watch out:")),
        )
    ]


AI_DRYING_PLANNER = Recipe(
    code="ai_drying_planner",
    title="Drying planner",
    description=(
        "Early each morning when wet palay is waiting, which lots to dry when over the next three days, "
        "planned around the rain at your mill."
    ),
    group="advisor",
    section="paddy",
    default_roles=("owner", "mill_operator"),
    params=DryingPlanParams,
    fields=(
        Field(
            "location_id",
            "Where",
            "select",
            "The places saved on your weather card.",
            options=(("", "The first saved location"),),
            options_from="saved_locations",
        ),
        EMAIL_FIELD,
    ),
    schedule=_drying_schedule,
    build=_drying_planner,
    uses_ai=True,
)


# ── 7. month in review ───────────────────────────────────────────────────────


def _month_in_review(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    start, end = last_month(ctx.local_today)
    before_start, before_end = last_month(start)
    reports = _reports(ctx)
    this, before = reports.profit_and_loss(start, end), reports.profit_and_loss(before_start, before_end)
    volumes, earlier = week_totals(ctx, start, end), week_totals(ctx, before_start, before_end)
    categories = (
        ctx.db.query(ExpenseCategory.name, func.sum(Expense.amount))
        .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .filter(Expense.expense_date.between(start, end))
        .group_by(ExpenseCategory.name)
        .order_by(func.sum(Expense.amount).desc())
        .limit(5)
        .all()
    )
    top = (
        ctx.db.query(Customer.name, func.sum(SalesOrder.total_amount))
        .join(Customer, Customer.id == SalesOrder.customer_id)
        .filter(SalesOrder.order_date.between(start, end), SalesOrder.status.notin_(("draft", "cancelled")))
        .group_by(Customer.name)
        .order_by(func.sum(SalesOrder.total_amount).desc())
        .limit(5)
        .all()
    )
    pl_keys = ("revenue", "cost_of_goods", "gross_profit", "operating_expenses", "net_profit")
    facts = {
        "month": f"{start:%B %Y}",
        "profit_and_loss_php": {k: _n(this[k]) for k in pl_keys} | {"gross_margin_pct": this["gross_margin_pct"]},
        "previous_month_php": {k: _n(before[k]) for k in pl_keys} | {"gross_margin_pct": before["gross_margin_pct"]},
        "change_vs_previous_month_pct": {k: _change(this[k], before[k]) for k in pl_keys},
        "palay_bought_kg": _n(volumes["palay_kg"]),
        "palay_bought_change_pct": _change(volumes["palay_kg"], earlier["palay_kg"]),
        "rice_milled_kg": _n(volumes["milled_kg"]),
        "rice_milled_change_pct": _change(volumes["milled_kg"], earlier["milled_kg"]),
        "milling_recovery_pct": _n(volumes["recovery"], 1),
        "collected_php": _n(volumes["collected"]),
        "biggest_expense_categories_php": [{"category": n, "php": _n(a)} for n, a in categories],
        "receivables_by_days_late_php": {k: _n(v) for k, v in reports.ar_aging(today=end).items()},
        "top_customers_php": [{"customer": n, "php": _n(a)} for n, a in top],
    }
    task = (
        "Write last month's review in two short paragraphs the owner could hand to an accountant or a bank: "
        "how sales, costs and profit moved against the month before and why, then volumes, collections and "
        "what is owed to the mill. Plain, factual, no hype. Then list what to watch next month."
    )
    keys = (
        ai.Key(
            "review",
            "two short paragraphs, separated by ' || ', the first opening with the month's main point",
            limit=1500,
        ),
        ai.Key("watch", "what to watch next month", limit=220, is_list=True, max_items=3),
    )

    def render(answer: dict[str, Any]) -> list[str]:
        # The title already says which month; the review opens with the headline's point.
        lines = [p.strip() for p in answer.get("review", "").split("||") if p.strip()]
        if answer.get("watch"):
            lines += ["", "Next month, watch:"] + [f"{i}. {w}" for i, w in enumerate(answer["watch"], start=1)]
        return lines

    figures = [
        f"Sales {peso(this['revenue'])}, palay cost {peso(this['cost_of_goods'])}, expenses {peso(this['operating_expenses'])}",
        f"Net profit {peso(this['net_profit'])}; the month before {peso(before['net_profit'])}",
    ]
    return [
        advise(
            ctx,
            title=f"{start:%B} in review",
            dedupe_key=f"ai_month_in_review:{start:%Y-%m}",
            link="/reports",
            task=task,
            facts=facts,
            figures=figures,
            keys=keys,
            render=render,
        )
    ]


AI_MONTH_IN_REVIEW = Recipe(
    code="ai_month_in_review",
    title="Month in review",
    description="On the 1st, last month told in two short paragraphs, fit to share with your accountant or bank.",
    group="advisor",
    section="reports",
    default_roles=("owner", "accountant"),
    params=_EmailOnly,
    fields=(EMAIL_FIELD,),
    schedule=lambda _p: monthly(1, time(8, 0)),
    build=_month_in_review,
    uses_ai=True,
)


ADVISOR_RECIPES = (
    AI_BRIEFING,
    AI_COLLECTION_DRAFTS,
    AI_BUYING_ADVISOR,
    AI_LEAKAGE_WATCH,
    AI_MARGIN_CHECK,
    AI_DRYING_PLANNER,
    AI_MONTH_IN_REVIEW,
)
