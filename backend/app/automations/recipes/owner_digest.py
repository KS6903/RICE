"""Morning summary: yesterday at the mill, before the working day starts."""

from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, field_validator
from pydantic import Field as PydanticField
from sqlalchemy import func

from ...jobs.schedule import Schedule
from ...models.costs import Expense
from ...models.milling import MillingBatch, MillingBatchOutput
from ...models.paddy import PalayPurchase, PalayPurchaseItem
from ...models.sales import Invoice, Payment, SalesOrder
from ..base import Field, Notice, Recipe, RecipeContext

# A summary of yesterday is only useful in the morning. If the jobs runner was
# down until after this, the day's digest is skipped rather than sent late.
LATEST_SEND = time(12, 0)
KG_PER_CAVAN = Decimal(50)


class OwnerDigestParams(BaseModel):
    send_at: str = PydanticField("06:00", description="Local time, HH:MM, before noon")
    email: bool = True

    @field_validator("send_at")
    @classmethod
    def _morning_time(cls, value: str) -> str:
        try:
            parsed = time.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Use a time like 06:00") from exc
        if not time(4, 0) <= parsed < LATEST_SEND:
            raise ValueError("Pick a time between 04:00 and 11:59")
        return parsed.strftime("%H:%M")


def _schedule(params: BaseModel) -> Schedule:
    assert isinstance(params, OwnerDigestParams)
    send_at = time.fromisoformat(params.send_at)

    def due(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        return local.date().isoformat() if send_at <= local.time() < LATEST_SEND else None

    return due


def _peso(amount: Decimal | float | int | None) -> str:
    return f"₱{Decimal(amount or 0):,.0f}"


def _kg(amount: Decimal | float | int | None) -> str:
    return f"{Decimal(amount or 0):,.0f} kg"


def _build(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    db = ctx.db
    day = ctx.local_today - timedelta(days=1)
    day_start, day_end = ctx.local_day_bounds_utc(day)

    net_kg = PalayPurchaseItem.gross_weight_kg - PalayPurchaseItem.tare_weight_kg
    palay_kg, palay_cost = (
        db.query(func.sum(net_kg), func.sum(net_kg / KG_PER_CAVAN * PalayPurchaseItem.price_per_cavan))
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(PalayPurchase.purchase_date == day, PalayPurchase.status != "cancelled")
        .one()
    )
    milled_kg = (
        db.query(func.sum(MillingBatchOutput.output_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchOutput.batch_id)
        .filter(
            MillingBatchOutput.output_type == "milled_rice",
            MillingBatch.status != "cancelled",
            MillingBatch.end_datetime >= day_start,
            MillingBatch.end_datetime < day_end,
        )
        .scalar()
    )
    sales = (
        db.query(func.sum(SalesOrder.total_amount))
        .filter(SalesOrder.order_date == day, SalesOrder.status.notin_(("draft", "cancelled")))
        .scalar()
    )
    collected = db.query(func.sum(Payment.amount)).filter(Payment.payment_date == day).scalar()
    expenses = db.query(func.sum(Expense.amount)).filter(Expense.expense_date == day).scalar()
    overdue_count, overdue_balance = (
        db.query(func.count(Invoice.id), func.sum(Invoice.total_amount - Invoice.paid_amount))
        .filter(Invoice.status == "overdue")
        .one()
    )

    lines = [
        f"Palay bought: {_kg(palay_kg)} for {_peso(palay_cost)}",
        f"Rice milled: {_kg(milled_kg)}",
        f"Sales: {_peso(sales)}. Collected: {_peso(collected)}",
        f"Expenses: {_peso(expenses)}",
    ]
    if overdue_count:
        noun = "invoice" if overdue_count == 1 else "invoices"
        lines.append(f"Needs attention: {overdue_count} overdue {noun}, {_peso(overdue_balance)} unpaid")
    return [
        Notice(
            title=f"Yesterday at {ctx.company.name} ({day:%a %d %b})",
            body="\n".join(lines),
            link="/reports",
            dedupe_key=f"owner_digest:{day.isoformat()}",
        )
    ]


OWNER_DIGEST = Recipe(
    code="owner_digest",
    title="Morning summary",
    description=(
        "Every morning, yesterday at a glance: palay bought, rice milled, sales, "
        "collections and expenses, plus any overdue invoices."
    ),
    group="reports",
    section="reports",
    default_roles=("owner",),
    params=OwnerDigestParams,
    fields=(
        Field("send_at", "Send at", "time", "Your mill's local time, before noon."),
        Field("email", "Also email it", "bool", "It always appears under the bell too."),
    ),
    schedule=_schedule,
    build=_build,
)
