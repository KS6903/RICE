"""Reports and summaries: the numbers an owner or accountant would ask for,
sent on a schedule, with a CSV to open in Excel where it helps."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from pydantic import BaseModel, field_validator
from pydantic import Field as PydanticField
from sqlalchemy import func

from ...jobs.schedule import MONDAY, Schedule, daily, monthly, weekly
from ...models.costs import Expense
from ...models.milling import (
    ByproductInventory,
    MilledRiceInventory,
    MillingBatch,
    MillingBatchInput,
    MillingBatchOutput,
)
from ...models.paddy import DryingRecord, PalayInventory, PalayPurchase, PalayPurchaseItem
from ...models.reference import RiceVariety
from ...models.sales import Invoice, Payment, SalesOrder
from ...models.user import User
from ...services.reports_service import ReportsService
from .. import credit
from ..base import Field, Notice, Recipe, RecipeContext
from ..csvfile import csv_attachment
from ..format import KG_PER_CAVAN, kg, peso, plural
from .watch import EMAIL_FIELD

SEVEN = time(7, 0)


def _reports(ctx: RecipeContext) -> ReportsService:
    # The service reads only the company from its user.
    return ReportsService(ctx.db, SimpleNamespace(company_id=ctx.company.id, company=ctx.company))


def last_week(today: date) -> tuple[date, date]:
    """Monday to Sunday of the week before ``today``'s."""
    monday = today - timedelta(days=today.weekday() + 7)
    return monday, monday + timedelta(days=6)


def last_month(today: date) -> tuple[date, date]:
    end = today.replace(day=1) - timedelta(days=1)
    return end.replace(day=1), end


def _span(start: date, end: date) -> str:
    if start == end:
        return f"{start:%a %d %b}"
    if start.month == end.month:
        return f"{start.day}–{end:%d %b}"
    return f"{start:%d %b}–{end:%d %b}"


# ── scheduled report ─────────────────────────────────────────────────────────

REPORTS = (("pnl", "Profit and loss"), ("ar_aging", "Who owes you (receivables)"), ("stock", "Stock on hand"))
EVERY = (("day", "Every morning"), ("week", "Monday mornings"), ("month", "On the 1st of the month"))


class ScheduledReportParams(BaseModel):
    report: str = PydanticField("pnl", pattern="^(pnl|ar_aging|stock)$")
    every: str = PydanticField("week", pattern="^(day|week|month)$")
    email: bool = True


def _report_schedule(params: BaseModel) -> Schedule:
    assert isinstance(params, ScheduledReportParams)
    if params.every == "day":
        return daily(SEVEN)
    if params.every == "week":
        return weekly(MONDAY, SEVEN)
    return monthly(1, SEVEN)


def _period(params: ScheduledReportParams, today: date) -> tuple[date, date, str]:
    if params.every == "day":
        day = today - timedelta(days=1)
        return day, day, "yesterday"
    if params.every == "week":
        start, end = last_week(today)
        return start, end, "last week"
    start, end = last_month(today)
    return start, end, f"{start:%B}"


def _pnl(ctx: RecipeContext, params: ScheduledReportParams) -> Notice:
    start, end, label = _period(params, ctx.local_today)
    r = _reports(ctx).profit_and_loss(start, end)
    rows = [
        ("Sales (invoiced and paid orders)", r["revenue"]),
        ("Cost of palay bought", r["cost_of_goods"]),
        ("Gross profit", r["gross_profit"]),
        ("Expenses", r["operating_expenses"]),
        ("Net profit", r["net_profit"]),
    ]
    body = [f"{name}: {peso(amount)}" for name, amount in rows]
    body.insert(3, f"Gross margin: {r['gross_margin_pct']:g}%")
    return Notice(
        title=f"Profit and loss, {label} ({_span(start, end)})",
        body="\n".join(body),
        link="/reports",
        dedupe_key=f"scheduled_report:pnl:{start.isoformat()}:{end.isoformat()}",
        attachments=(
            csv_attachment(
                f"profit-and-loss-{start.isoformat()}-to-{end.isoformat()}.csv",
                ("Item", "Amount (PHP)"),
                [*rows, ("Gross margin (%)", r["gross_margin_pct"])],
            ),
        ),
    )


def _ar_aging(ctx: RecipeContext, params: ScheduledReportParams) -> Notice:
    today = ctx.local_today
    buckets = _reports(ctx).ar_aging(today=today)
    invoices = (
        ctx.db.query(Invoice)
        .filter(Invoice.status.in_(credit.OPEN_INVOICE))
        .order_by(func.coalesce(Invoice.due_date, Invoice.invoice_date))
        .all()
    )
    rows = []
    for inv in invoices:
        balance = Decimal(inv.total_amount - inv.paid_amount)
        if balance <= 0:
            continue
        due = inv.due_date or inv.invoice_date
        rows.append(
            (
                inv.invoice_no,
                inv.customer.name if inv.customer else "",
                inv.invoice_date,
                due,
                inv.total_amount,
                inv.paid_amount,
                balance,
                max(0, (today - due).days),
            )
        )
    labels = (
        ("current", "Not yet due"),
        ("1_30", "1 to 30 days late"),
        ("31_60", "31 to 60 days late"),
        ("61_90", "61 to 90 days late"),
        ("over_90", "Over 90 days late"),
    )
    total = sum(buckets.values())
    return Notice(
        title=f"Who owes you: {peso(total)} as of {today:%d %b}",
        body="\n".join(f"{label}: {peso(buckets[key])}" for key, label in labels),
        link="/reports",
        dedupe_key=f"scheduled_report:ar_aging:{params.every}:{today.isoformat()}",
        attachments=(
            csv_attachment(
                f"receivables-{today.isoformat()}.csv",
                ("Invoice", "Customer", "Invoice date", "Due date", "Total", "Paid", "Balance", "Days late"),
                rows,
            ),
        ),
    )


def _stock(ctx: RecipeContext, params: ScheduledReportParams) -> Notice:
    db, today = ctx.db, ctx.local_today
    names = {v.id: v.name for v in db.query(RiceVariety).all()}
    rows: list[tuple] = []
    totals: dict[str, Decimal] = defaultdict(Decimal)
    for r in db.query(MilledRiceInventory).filter(MilledRiceInventory.quantity_kg != 0).all():
        rows.append(
            ("Milled rice", names.get(r.variety_id, "") if r.variety_id else "", r.grade_name or "", r.quantity_kg)
        )
        totals["Milled rice"] += Decimal(r.quantity_kg)
    for p in db.query(PalayInventory).filter(PalayInventory.quantity_kg != 0).all():
        rows.append(("Palay", names.get(p.variety_id, "") if p.variety_id else "", "", p.quantity_kg))
        totals["Palay"] += Decimal(p.quantity_kg)
    for b in db.query(ByproductInventory).filter(ByproductInventory.quantity_kg != 0).all():
        rows.append(("By-product", b.byproduct_type.replace("_", " "), "", b.quantity_kg))
        totals["By-products"] += Decimal(b.quantity_kg)
    body = [f"{name}: {kg(amount)}" for name, amount in totals.items()] or ["Nothing in stock."]
    return Notice(
        title=f"Stock on hand, {today:%d %b}",
        body="\n".join(body),
        link="/inventory",
        dedupe_key=f"scheduled_report:stock:{params.every}:{today.isoformat()}",
        attachments=(
            csv_attachment(f"stock-{today.isoformat()}.csv", ("Kind", "Variety", "Grade", "Kilograms"), rows),
        ),
    )


def _scheduled_report(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, ScheduledReportParams)
    build = {"pnl": _pnl, "ar_aging": _ar_aging, "stock": _stock}[params.report]
    return [build(ctx, params)]


SCHEDULED_REPORT = Recipe(
    code="scheduled_report",
    title="Scheduled report",
    description="A report on a schedule, with a spreadsheet (CSV) attached to the email.",
    group="reports",
    section="reports",
    default_roles=("owner", "accountant"),
    params=ScheduledReportParams,
    fields=(
        Field("report", "Report", "select", options=REPORTS),
        Field("every", "When", "select", "At 7 in the morning.", options=EVERY),
        Field("email", "Also email it", "bool", "The spreadsheet comes with the email."),
    ),
    schedule=_report_schedule,
    build=_scheduled_report,
)


# ── weekly summary ───────────────────────────────────────────────────────────


def week_totals(ctx: RecipeContext, start: date, end: date) -> dict[str, Decimal]:
    """The week's main figures, by business date (and local time for milling)."""
    db = ctx.db
    first, _ = ctx.local_day_bounds_utc(start)
    _, after = ctx.local_day_bounds_utc(end)
    net = PalayPurchaseItem.gross_weight_kg - PalayPurchaseItem.tare_weight_kg
    palay_kg, palay_cost = (
        db.query(func.sum(net), func.sum(net / KG_PER_CAVAN * PalayPurchaseItem.price_per_cavan))
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(PalayPurchase.purchase_date.between(start, end), PalayPurchase.status != "cancelled")
        .one()
    )
    finished = (
        MillingBatch.status == "completed",
        MillingBatch.end_datetime >= first,
        MillingBatch.end_datetime < after,
    )
    milled = (
        db.query(func.sum(MillingBatchOutput.output_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchOutput.batch_id)
        .filter(MillingBatchOutput.output_type == "milled_rice", *finished)
        .scalar()
    )
    milled_from = (
        db.query(func.sum(MillingBatchInput.input_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchInput.batch_id)
        .filter(*finished)
        .scalar()
    )
    sales = (
        db.query(func.sum(SalesOrder.total_amount))
        .filter(SalesOrder.order_date.between(start, end), SalesOrder.status.notin_(("draft", "cancelled")))
        .scalar()
    )
    collected = db.query(func.sum(Payment.amount)).filter(Payment.payment_date.between(start, end)).scalar()
    expenses = db.query(func.sum(Expense.amount)).filter(Expense.expense_date.between(start, end)).scalar()
    d = lambda v: Decimal(v or 0)  # noqa: E731
    return {
        "palay_kg": d(palay_kg),
        "palay_cost": d(palay_cost),
        "milled_kg": d(milled),
        "recovery": d(milled) / d(milled_from) * 100 if milled_from else Decimal(0),
        "sales": d(sales),
        "collected": d(collected),
        "expenses": d(expenses),
    }


def _change(now: Decimal, before: Decimal) -> str:
    if not before:
        return ""
    pct = (now - before) / before * 100
    if abs(pct) < 1:
        return " (about the same as the week before)"
    return f" ({'up' if pct > 0 else 'down'} {abs(pct):.0f}% on the week before)"


class WeeklySummaryParams(BaseModel):
    email: bool = True


def _weekly_summary(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    start, end = last_week(ctx.local_today)
    this = week_totals(ctx, start, end)
    prev = week_totals(ctx, start - timedelta(days=7), end - timedelta(days=7))
    lines = [
        f"Palay bought: {kg(this['palay_kg'])} for {peso(this['palay_cost'])}{_change(this['palay_kg'], prev['palay_kg'])}",
        f"Rice milled: {kg(this['milled_kg'])}{_change(this['milled_kg'], prev['milled_kg'])}",
    ]
    if this["recovery"]:
        was = f", {prev['recovery']:.1f}% the week before" if prev["recovery"] else ""
        lines.append(f"Milling recovery: {this['recovery']:.1f}%{was}")
    lines += [
        f"Sales: {peso(this['sales'])}{_change(this['sales'], prev['sales'])}",
        f"Collected: {peso(this['collected'])}{_change(this['collected'], prev['collected'])}",
        f"Expenses: {peso(this['expenses'])}{_change(this['expenses'], prev['expenses'])}",
    ]
    return [
        Notice(
            title=f"Last week at {ctx.company.name} ({_span(start, end)})",
            body="\n".join(lines),
            link="/reports",
            dedupe_key=f"weekly_summary:{start.isoformat()}",
        )
    ]


WEEKLY_SUMMARY = Recipe(
    code="weekly_summary",
    title="Weekly summary",
    description="Monday mornings, last week's palay, milling, sales, collections and expenses against the week before.",
    group="reports",
    section="reports",
    default_roles=("owner",),
    params=WeeklySummaryParams,
    fields=(EMAIL_FIELD,),
    schedule=lambda _params: weekly(MONDAY, SEVEN),
    build=_weekly_summary,
)


# ── end-of-day cash-up ───────────────────────────────────────────────────────

METHOD_NAMES = {"cash": "Cash", "gcash": "GCash", "bank_transfer": "Bank transfer", "check": "Cheque"}


class CashUpParams(BaseModel):
    send_at: str = "18:00"
    email: bool = True

    @field_validator("send_at")
    @classmethod
    def _afternoon(cls, value: str) -> str:
        try:
            parsed = time.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Use a time like 18:00") from exc
        if not time(12, 0) <= parsed <= time(23, 0):
            raise ValueError("Pick a time between 12:00 and 23:00")
        return parsed.strftime("%H:%M")


def _cash_up_schedule(params: BaseModel) -> Schedule:
    assert isinstance(params, CashUpParams)
    return daily(time.fromisoformat(params.send_at))


def _cash_up(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    today = ctx.local_today
    by_method = (
        ctx.db.query(Payment.method, func.count(Payment.id), func.sum(Payment.amount))
        .filter(Payment.payment_date == today)
        .group_by(Payment.method)
        .all()
    )
    if not by_method:
        return [
            Notice(
                title=f"Cash-up for {today:%a %d %b}: no payments",
                body="No payments were recorded today.",
                link="/cash",
                dedupe_key=f"cash_up:{today.isoformat()}",
            )
        ]
    total = sum((Decimal(amount or 0) for _, _, amount in by_method), Decimal(0))
    lines = [
        f"{METHOD_NAMES.get(method, method.replace('_', ' ').capitalize())}: {peso(amount)} ({plural(count, 'payment')})"
        for method, count, amount in sorted(by_method, key=lambda r: -Decimal(r[2] or 0))
    ]
    by_person = (
        ctx.db.query(User.full_name, func.sum(Payment.amount))
        .join(User, User.id == Payment.received_by)
        .filter(Payment.payment_date == today, Payment.method == "cash")
        .group_by(User.full_name)
        .all()
    )
    if by_person:
        lines.append("Cash received by:")
        lines += [f"{name}: {peso(amount)}" for name, amount in sorted(by_person, key=lambda r: -Decimal(r[1] or 0))]
    return [
        Notice(
            title=f"Cash-up for {today:%a %d %b}: {peso(total)} received",
            body="\n".join(lines),
            link="/cash",
            dedupe_key=f"cash_up:{today.isoformat()}",
        )
    ]


CASH_UP = Recipe(
    code="cash_up",
    title="End-of-day cash-up",
    description=(
        "Each evening, today's payments by method and the cash each person took, to count the drawer "
        "against on the Cash count page."
    ),
    group="reports",
    section="sales",
    default_roles=("owner", "cashier"),
    params=CashUpParams,
    fields=(Field("send_at", "Send at", "time", "Your mill's local time, after closing."), EMAIL_FIELD),
    schedule=_cash_up_schedule,
    build=_cash_up,
)


# ── month-end checklist ──────────────────────────────────────────────────────

CLOSING = time(16, 0)


def _month_end_schedule(_params: BaseModel) -> Schedule:
    def due(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        last = calendar.monthrange(local.year, local.month)[1]
        if local.day != last or local.time() < CLOSING:
            return None
        return f"{local.year}-{local.month:02d}"

    return due


class MonthEndParams(BaseModel):
    email: bool = True


def _month_end(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    db, today = ctx.db, ctx.local_today
    week_ago = today - timedelta(days=7)
    invoiced = db.query(Invoice.id).filter(Invoice.order_id == SalesOrder.id).exists()
    checks = [
        (
            db.query(func.count(MillingBatch.id)).filter(MillingBatch.status == "in_progress").scalar() or 0,
            "milling batch still open",
            "milling batches still open",
        ),
        (
            db.query(func.count(DryingRecord.id)).filter(DryingRecord.end_datetime.is_(None)).scalar() or 0,
            "drying run not finished",
            "drying runs not finished",
        ),
        (
            db.query(func.count(SalesOrder.id)).filter(SalesOrder.status == "draft").scalar() or 0,
            "draft sales order",
            "draft sales orders",
        ),
        (
            db.query(func.count(SalesOrder.id))
            .filter(
                SalesOrder.status.in_(("confirmed", "delivered")),
                SalesOrder.order_date <= week_ago,
                ~invoiced,
            )
            .scalar()
            or 0,
            "order over a week old with no invoice",
            "orders over a week old with no invoice",
        ),
        (
            sum(
                db.query(func.count(model.id)).filter(model.quantity_kg < 0).scalar() or 0
                for model in (MilledRiceInventory, PalayInventory, ByproductInventory)
            ),
            "stock item below zero",
            "stock items below zero",
        ),
    ]
    overdue_count, overdue_total = (
        db.query(func.count(Invoice.id), func.sum(Invoice.total_amount - Invoice.paid_amount))
        .filter(Invoice.status == "overdue")
        .one()
    )
    lines = [f"{plural(count, one, many)}" for count, one, many in checks if count]
    if overdue_count:
        lines.append(f"{plural(overdue_count, 'overdue invoice')}, {peso(overdue_total)} unpaid")
    if not lines:
        body = "Nothing open. The books are ready to close."
    else:
        body = "Before you close the month:\n" + "\n".join(f"- {line}" for line in lines)
    return [
        Notice(
            title=f"Closing {today:%B}: {plural(len(lines), 'thing', 'things')} to check"
            if lines
            else f"Closing {today:%B}: all clear",
            body=body,
            link="/reports",
            dedupe_key=f"month_end:{today:%Y-%m}",
        )
    ]


MONTH_END = Recipe(
    code="month_end",
    title="Month-end checklist",
    description="At 4 in the afternoon on the last day of the month, what's still open before you close the books.",
    group="reports",
    section="reports",
    default_roles=("owner", "accountant"),
    params=MonthEndParams,
    fields=(EMAIL_FIELD,),
    schedule=_month_end_schedule,
    build=_month_end,
)


REPORT_RECIPES = (SCHEDULED_REPORT, WEEKLY_SUMMARY, CASH_UP, MONTH_END)
