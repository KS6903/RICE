"""Collections and credit: who owes the mill, and who is buying past their limit."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, time, timedelta
from decimal import Decimal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import func

from ...jobs.schedule import MONDAY, SATURDAY, Schedule, daily, weekly
from ...models.sales import Invoice, SalesOrder
from ...models.supplier_customer import Customer
from .. import credit
from ..base import Field, Notice, Recipe, RecipeContext
from ..format import peso, plural
from ..state import newly_true
from .watch import EMAIL_FIELD

MORNING = time(8, 0)
MAX_LINES = 15


def _capped(lines: list[str]) -> list[str]:
    if len(lines) <= MAX_LINES:
        return lines
    return [*lines[:MAX_LINES], f"…and {len(lines) - MAX_LINES} more."]


def _due(inv: Invoice) -> date:
    return inv.due_date or inv.invoice_date


def _customer(inv: Invoice) -> str:
    return inv.customer.name if inv.customer else "A walk-in customer"


# ── due and overdue invoices ─────────────────────────────────────────────────


class DueRemindersParams(BaseModel):
    days_before: int = PydanticField(3, ge=0, le=30)
    email: bool = True


def _mon_to_sat(_params: BaseModel) -> Schedule:
    return daily(MORNING, days=frozenset(range(MONDAY, SATURDAY + 1)))


def _due_reminders(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, DueRemindersParams)
    today = ctx.local_today
    horizon = today + timedelta(days=params.days_before)
    invoices = (
        ctx.db.query(Invoice)
        .filter(
            Invoice.status.in_(credit.OPEN_INVOICE),
            func.coalesce(Invoice.due_date, Invoice.invoice_date) <= horizon,
        )
        .all()
    )
    invoices = [inv for inv in invoices if inv.total_amount > inv.paid_amount]
    if not invoices:
        return []
    invoices.sort(key=_due)
    late = [inv for inv in invoices if _due(inv) < today]
    soon = [inv for inv in invoices if _due(inv) >= today]
    lines: list[str] = []
    if late:
        lines.append(f"Overdue ({peso(sum(i.total_amount - i.paid_amount for i in late))}):")
        lines += _capped(
            [
                f"{inv.invoice_no}, {_customer(inv)}: {peso(inv.total_amount - inv.paid_amount)}, "
                f"{plural((today - _due(inv)).days, 'day')} late"
                + (f". {inv.customer.phone}" if inv.customer and inv.customer.phone else "")
                for inv in late
            ]
        )
    if soon:
        lines.append(f"Due soon ({peso(sum(i.total_amount - i.paid_amount for i in soon))}):")
        lines += _capped(
            [
                f"{inv.invoice_no}, {_customer(inv)}: {peso(inv.total_amount - inv.paid_amount)}, "
                + ("due today" if _due(inv) == today else f"due {_due(inv):%a %d %b}")
                for inv in soon
            ]
        )
    parts = [
        p for p in (plural(len(late), "overdue invoice") if late else "", f"{len(soon)} due soon" if soon else "") if p
    ]
    return [
        Notice(
            title="Collections: " + ", ".join(parts),
            body="\n".join(lines),
            link="/sales",
            dedupe_key=f"due_reminders:{today.isoformat()}",
        )
    ]


DUE_REMINDERS = Recipe(
    code="due_reminders",
    title="Invoices due and overdue",
    description="Every morning except Sunday, the invoices to collect: overdue first, then those due soon.",
    group="receivables",
    section="sales",
    default_roles=("accountant", "owner"),
    params=DueRemindersParams,
    fields=(
        Field("days_before", "Include invoices due within", "number", "Sent at 8 in the morning.", unit="days"),
        EMAIL_FIELD,
    ),
    schedule=_mon_to_sat,
    build=_due_reminders,
)


# ── weekly call list ─────────────────────────────────────────────────────────


class CallListParams(BaseModel):
    email: bool = True


def _monday(_params: BaseModel) -> Schedule:
    return weekly(MONDAY, MORNING)


def _call_list(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    today = ctx.local_today
    overdue = (
        ctx.db.query(Invoice)
        .filter(Invoice.status.in_(credit.OPEN_INVOICE), func.coalesce(Invoice.due_date, Invoice.invoice_date) < today)
        .all()
    )
    by_customer: dict = defaultdict(lambda: [Decimal(0), 0, None])
    for inv in overdue:
        balance = Decimal(inv.total_amount - inv.paid_amount)
        if balance <= 0:
            continue
        entry = by_customer[inv.customer_id]
        entry[0] += balance
        entry[1] = max(entry[1], (today - _due(inv)).days)
        entry[2] = inv.customer
    if not by_customer:
        return []
    ranked = sorted(by_customer.values(), key=lambda e: (-e[0], -e[1]))[:10]
    lines = []
    for n, (balance, oldest, customer) in enumerate(ranked, start=1):
        name = customer.name if customer else "Walk-in customers"
        phone = f". {customer.phone}" if customer and customer.phone else ""
        lines.append(f"{n}. {name}: {peso(balance)} overdue, oldest {plural(oldest, 'day')}{phone}")
    total = sum((e[0] for e in by_customer.values()), Decimal(0))
    year, week, _ = today.isocalendar()
    return [
        Notice(
            title=f"Who to call this week: {peso(total)} overdue",
            body="\n".join(lines),
            link="/sales",
            dedupe_key=f"call_list:{year}-W{week:02d}",
        )
    ]


CALL_LIST = Recipe(
    code="call_list",
    title="Who to call this week",
    description="Monday mornings, the ten customers who owe you the most overdue money, with their numbers.",
    group="receivables",
    section="sales",
    default_roles=("accountant", "owner"),
    params=CallListParams,
    fields=(EMAIL_FIELD,),
    schedule=_monday,
    build=_call_list,
)


# ── credit guard ─────────────────────────────────────────────────────────────


class CreditGuardParams(BaseModel):
    mode: str = PydanticField("warn", pattern="^(warn|block)$")
    email: bool = True


def _credit_guard(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    """The morning check. New orders are checked as they're entered (credit.check)."""
    customers = ctx.db.query(Customer).filter(Customer.credit_limit > 0, Customer.is_active.is_(True)).all()
    if not customers:
        return []
    balances = credit.owed(ctx.db, [c.id for c in customers])
    over = {
        str(c.id): (
            balances[c.id] - c.credit_limit,
            f"{c.name}: owes {peso(balances[c.id])} on a {peso(c.credit_limit)} limit",
        )
        for c in customers
        if balances.get(c.id, Decimal(0)) > c.credit_limit
    }
    new = sorted(newly_true(ctx, credit.RECIPE, over), key=lambda k: -over[k][0])
    if not new:
        return []
    return [
        Notice(
            title=f"Over their credit limit: {plural(len(new), 'customer')}",
            body="\n".join(over[key][1] for key in new),
            link="/sales",
            dedupe_key=f"{credit.RECIPE}:{ctx.local_today.isoformat()}",
        )
    ]


CREDIT_GUARD = Recipe(
    code=credit.RECIPE,
    title="Credit limit guard",
    description=(
        "When an order would take a customer over their credit limit, warn you or stop it until you approve. "
        "Also each morning, customers newly over their limit."
    ),
    group="receivables",
    section="sales",
    default_roles=("owner",),
    params=CreditGuardParams,
    fields=(
        Field(
            "mode",
            "When an order goes over the limit",
            "select",
            "Customers with a limit of 0 have no limit.",
            options=(("warn", "Let it through and tell me"), ("block", "Stop it until an owner or admin approves")),
        ),
        EMAIL_FIELD,
    ),
    schedule=lambda _params: daily(MORNING),
    build=_credit_guard,
)


# ── customers gone quiet ─────────────────────────────────────────────────────

REGULAR_WINDOW = timedelta(days=180)
REGULAR_ORDERS = 3


class QuietParams(BaseModel):
    days: int = PydanticField(30, ge=7, le=180)
    email: bool = True


def _quiet_customers(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, QuietParams)
    today = ctx.local_today
    rows = (
        ctx.db.query(SalesOrder.customer_id, func.count(SalesOrder.id), func.max(SalesOrder.order_date))
        .filter(
            SalesOrder.customer_id.isnot(None),
            SalesOrder.status.notin_(("draft", "cancelled")),
            SalesOrder.order_date >= today - REGULAR_WINDOW,
        )
        .group_by(SalesOrder.customer_id)
        .having(func.count(SalesOrder.id) >= REGULAR_ORDERS)
        .all()
    )
    quiet = {str(cid): (count, last) for cid, count, last in rows if (today - last).days >= params.days}
    new = newly_true(ctx, "quiet_customers", quiet)
    if not new:
        return []
    customers = {str(c.id): c for c in ctx.db.query(Customer).all()}
    lines = []
    for key in sorted(new, key=lambda k: quiet[k][1]):
        count, last = quiet[key]
        c = customers.get(key)
        if c is None or not c.is_active:
            continue
        phone = f". {c.phone}" if c.phone else ""
        lines.append(
            f"{c.name}: last ordered {last:%d %b} ({plural((today - last).days, 'day')} ago), "
            f"{plural(count, 'order')} in the 6 months before{phone}"
        )
    if not lines:
        return []
    return [
        Notice(
            title=f"Regular customers gone quiet: {len(lines)}",
            body="\n".join(_capped(lines)),
            link="/sales",
            dedupe_key=f"quiet_customers:{today.isoformat()}",
        )
    ]


QUIET_CUSTOMERS = Recipe(
    code="quiet_customers",
    title="Regular customers gone quiet",
    description="Mondays, customers who used to order often and have stopped. Each is named once until they order again.",
    group="receivables",
    section="sales",
    default_roles=("owner",),
    params=QuietParams,
    fields=(
        Field("days", "No order for", "number", "Regular means 3 or more orders in the last 6 months.", unit="days"),
        EMAIL_FIELD,
    ),
    schedule=_monday,
    build=_quiet_customers,
)


RECEIVABLES_RECIPES = (DUE_REMINDERS, CALL_LIST, CREDIT_GUARD, QUIET_CUSTOMERS)
