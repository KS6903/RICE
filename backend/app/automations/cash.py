"""The cash drawer, reconciled: what should be in it against what's counted.

The cash-up recipe lists the day's payments; this goes further. Opening cash
plus the cash received, less the cash paid out, is what the drawer should
hold; the cashier counts it, and a difference beyond the mill's tolerance goes
to the owner at once and waits for an owner or admin to review it.

Payments are recorded with a method, so cash in is worked out from them. Cash
paid out isn't recorded anywhere else (expenses and palay purchases carry no
payment method), so the counter enters it; the day's expenses are shown as a
reminder of what may have come from the drawer.
"""

from __future__ import annotations

from datetime import date, time
from decimal import Decimal

from pydantic import BaseModel, field_validator
from pydantic import Field as PydanticField
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..jobs.schedule import Schedule, daily
from ..models.automation import AutomationRule
from ..models.base import now_utc
from ..models.cash import CashCount
from ..models.company import Company
from ..models.costs import Expense
from ..models.sales import Payment
from ..models.user import User
from . import actions
from .base import Field, Notice, Recipe, RecipeContext
from .format import peso

RECIPE = "cash_count"


def cash_received(db: Session, day: date) -> list[tuple[str, Decimal]]:
    """The day's cash payments, by who took them."""
    rows = (
        db.query(User.full_name, User.username, func.sum(Payment.amount))
        .outerjoin(User, User.id == Payment.received_by)
        .filter(Payment.payment_date == day, Payment.method == "cash")
        .group_by(User.full_name, User.username)
        .all()
    )
    return [(full or user or "Not recorded", Decimal(amount or 0)) for full, user, amount in rows]


def expenses_on(db: Session, day: date) -> Decimal:
    return Decimal(db.query(func.sum(Expense.amount)).filter(Expense.expense_date == day).scalar() or 0)


def opening_for(db: Session, day: date) -> Decimal:
    """What the drawer held at the start of ``day``: the last count before it,
    less what was taken out at that close. Nothing counted yet: zero."""
    last = db.query(CashCount).filter(CashCount.count_date < day).order_by(CashCount.count_date.desc()).first()
    return Decimal(last.counted) - Decimal(last.taken_out) if last else Decimal(0)


class CashCountParams(BaseModel):
    remind_at: str = "19:00"
    tolerance: int = PydanticField(100, ge=0, le=100_000)
    email: bool = True

    @field_validator("remind_at")
    @classmethod
    def _evening(cls, value: str) -> str:
        try:
            parsed = time.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Use a time like 19:00") from exc
        if not time(12, 0) <= parsed <= time(23, 0):
            raise ValueError("Pick a time between 12:00 and 23:00")
        return parsed.strftime("%H:%M")


def params_for(db: Session) -> tuple[AutomationRule | None, CashCountParams]:
    rule = db.query(AutomationRule).filter(AutomationRule.recipe == RECIPE).first()
    params = CashCountParams(**(rule.params or {})) if rule else CashCountParams()
    return rule, params


def needs_review(count: CashCount, tolerance: Decimal) -> bool:
    return abs(count.difference) > tolerance and count.reviewed_at is None


def save(
    db: Session,
    company: Company,
    user: User,
    *,
    day: date,
    counted: Decimal,
    cash_out: Decimal,
    taken_out: Decimal,
    opening: Decimal | None,
    note: str | None,
) -> CashCount:
    """Record (or correct) the day's count, working out the cash received.
    Tells the owner when it's out by more than the tolerance. Doesn't commit."""
    # Worked out before the row is added, so these queries don't flush a half-filled one.
    opening = opening if opening is not None else opening_for(db, day)
    cash_in = sum((amount for _, amount in cash_received(db, day)), Decimal(0))
    count = db.query(CashCount).filter(CashCount.count_date == day).first()
    if count is None:
        count = CashCount(company_id=company.id, count_date=day)
        db.add(count)
    count.opening = opening
    count.cash_in = cash_in
    count.cash_out = cash_out
    count.counted = counted
    count.taken_out = taken_out
    count.note = note
    count.counted_by = user.id
    count.reviewed_at = count.reviewed_by = count.review_note = None  # a new count, a new review
    db.flush()
    report(db, company, count, user)
    return count


def report(db: Session, company: Company, count: CashCount, user: User) -> None:
    """Tell the recipe's recipients about a count out by more than the
    tolerance, as soon as it's saved; tracked as a task when the rule says so."""
    from .engine import deliver, entitled, recipient_ids

    rule, params = params_for(db)
    if rule is None or not rule.enabled or not entitled(db, company.id):
        return
    diff = count.difference
    if abs(diff) <= params.tolerance:
        return
    who = user.full_name or user.username
    notice = Notice(
        title=f"Cash drawer {'short' if diff < 0 else 'over'} by {peso(abs(diff))} on {count.count_date:%a %d %b}",
        body=(
            f"Expected {peso(count.expected)}: opening {peso(count.opening)}, plus {peso(count.cash_in)} cash "
            f"received, less {peso(count.cash_out)} paid out. Counted {peso(count.counted)} by {who}."
            + (f"\nTheir note: {count.note}" if count.note else "")
            + "\nReview it on the Cash count page."
        ),
        link="/cash",
        dedupe_key=f"{RECIPE}:diff:{count.id}:{count.counted}:{count.cash_out}",
    )
    recipe = RECIPE_DEF
    # A difference is for the owner and admins, not for the cashier who counted.
    managers = {u.id for u in actions.team(db, company.id) if actions.is_manager(u)}
    recipients = [i for i in recipient_ids(db, company.id, recipe, rule.recipients or []) if i in managers] or list(
        managers
    )
    deliver(db, company, recipe, [notice], recipients, email=params.email)
    actions.track(db, company, rule, recipe, [notice], now=now_utc())


def _schedule(params: BaseModel) -> Schedule:
    assert isinstance(params, CashCountParams)
    return daily(time.fromisoformat(params.remind_at))


def _reminder(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    """In the evening, if nobody has counted the drawer today, say so."""
    today = ctx.local_today
    if ctx.db.query(CashCount.id).filter(CashCount.count_date == today).first():
        return []
    received = sum((amount for _, amount in cash_received(ctx.db, today)), Decimal(0))
    return [
        Notice(
            title=f"Count the cash drawer for {today:%a %d %b}",
            body=(
                f"Nobody has counted it yet. {peso(received)} in cash was received today. "
                "Count the drawer and enter it on the Cash count page."
            ),
            link="/cash",
            dedupe_key=f"{RECIPE}:remind:{today.isoformat()}",
        )
    ]


RECIPE_DEF = Recipe(
    code=RECIPE,
    title="Cash drawer count",
    description=(
        "Each evening, a reminder to count the drawer if nobody has. When a count comes out short or "
        "over by more than your allowance, you hear at once, and it waits for you to review it."
    ),
    group="reports",
    section="sales",
    default_roles=("owner", "cashier"),
    params=CashCountParams,
    fields=(
        Field("remind_at", "Remind at", "time", "Your mill's local time, after closing."),
        Field("tolerance", "Allow a difference of up to", "money", "Smaller differences need no review."),
        Field("email", "Also email it", "bool", "It always appears under the bell too."),
    ),
    schedule=_schedule,
    build=_reminder,
)


def last_counts(db: Session, days: int = 14) -> list[CashCount]:
    return db.query(CashCount).order_by(CashCount.count_date.desc()).limit(days).all()
