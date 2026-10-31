"""Stock counts: what's on the floor against what the records say.

The counter gets a sheet of every stock line with no recorded quantity on it,
so the count isn't nudged towards the records; the recorded quantities are
taken when the count is saved. Lines out by more than the allowance go to the
owner and admins at once and wait for one of them to review the count. A
count adjusts nothing: the stock is corrected in Inventory, after a look.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, time, timedelta
from decimal import Decimal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy.orm import Session

from ..jobs.schedule import MONDAY, Schedule, monthly, weekly
from ..models.automation import AutomationRule
from ..models.base import now_utc
from ..models.company import Branch, Company
from ..models.milling import ByproductInventory, MilledRiceInventory
from ..models.paddy import PalayInventory
from ..models.reference import RiceVariety
from ..models.stock_count import StockCount, StockCountLine
from ..models.user import User
from . import actions
from .base import Field, Notice, Recipe, RecipeContext
from .format import kg, plural, rice_name

RECIPE = "stock_count"
MODELS = {"milled_rice": MilledRiceInventory, "palay": PalayInventory, "byproduct": ByproductInventory}


@dataclass(frozen=True)
class SheetLine:
    kind: str
    inventory_id: uuid.UUID
    label: str
    recorded_kg: Decimal
    # The label in parts, so the sheet can group by branch and kind.
    item: str = ""
    branch: str | None = None
    # Only when the mill has several branches: there's nothing to pick otherwise.
    branch_id: uuid.UUID | None = None


def sheet(db: Session, company_id: uuid.UUID) -> list[SheetLine]:
    """Every stock line there is to count, with what the records say."""
    names: dict[uuid.UUID | None, str] = {v.id: v.name for v in db.query(RiceVariety).all()}
    # Branches live in public, shared by every mill: this mill's only.
    branches = {b.id: b.name for b in db.query(Branch).filter(Branch.company_id == company_id).all()}
    many = len(branches) > 1

    def line(kind: str, row, kind_name: str, item: str) -> SheetLine:
        branch = branches.get(row.branch_id) if many else None
        label = f"{kind_name}, {item}" + (f", {branch}" if branch else "")
        return SheetLine(
            kind, row.id, label, Decimal(row.quantity_kg or 0), item, branch, row.branch_id if many else None
        )

    lines = [
        line("milled_rice", r, "Milled rice", rice_name(names.get(r.variety_id), r.grade_name))
        for r in db.query(MilledRiceInventory).all()
    ]
    lines += [line("palay", p, "Palay", names.get(p.variety_id, "no variety")) for p in db.query(PalayInventory).all()]
    lines += [
        line("byproduct", b, "By-product", b.byproduct_type.replace("_", " "))
        for b in db.query(ByproductInventory).all()
    ]
    return sorted(lines, key=lambda line: line.label)


class StockCountParams(BaseModel):
    every: str = PydanticField("month", pattern="^(week|month)$")
    tolerance_pct: float = PydanticField(2, ge=0, le=50)
    email: bool = True


def params_for(db: Session) -> tuple[AutomationRule | None, StockCountParams]:
    rule = db.query(AutomationRule).filter(AutomationRule.recipe == RECIPE).first()
    return rule, StockCountParams(**(rule.params or {})) if rule else StockCountParams()


def out_of_line(line: StockCountLine, tolerance_pct: float) -> bool:
    """Off by more than the allowance, and by at least a kilo."""
    diff = abs(line.difference_kg)
    if diff < 1:
        return False
    return diff > Decimal(line.recorded_kg) * Decimal(str(tolerance_pct)) / 100


def needs_review(count: StockCount, tolerance_pct: float) -> bool:
    return count.reviewed_at is None and any(out_of_line(line, tolerance_pct) for line in count.lines)


def save(
    db: Session,
    company: Company,
    user: User,
    *,
    day: date,
    counted: dict[tuple[str, uuid.UUID], Decimal],
    note: str | None,
    branch_id: uuid.UUID | None = None,
) -> StockCount:
    """Record a count, taking each line's recorded quantity now. Lines not on
    the sheet are refused by the caller; lines left out weren't counted.
    Tells the owner when lines are out. Doesn't commit."""
    by_key = {(line.kind, line.inventory_id): line for line in sheet(db, company.id)}
    count = StockCount(company_id=company.id, branch_id=branch_id, count_date=day, note=note, counted_by=user.id)
    for key, quantity in counted.items():
        line = by_key[key]
        count.lines.append(
            StockCountLine(
                kind=line.kind,
                inventory_id=line.inventory_id,
                label=line.label[:160],
                recorded_kg=line.recorded_kg,
                counted_kg=quantity,
            )
        )
    db.add(count)
    db.flush()
    report(db, company, count, user)
    return count


def report(db: Session, company: Company, count: StockCount, user: User) -> None:
    from .engine import deliver, entitled, recipient_ids

    rule, params = params_for(db)
    if rule is None or not rule.enabled or not entitled(db, company.id):
        return
    out = [line for line in count.lines if out_of_line(line, params.tolerance_pct)]
    if not out:
        return
    who = user.full_name or user.username
    lines = [
        f"{line.label}: counted {kg(line.counted_kg)}, records say {kg(line.recorded_kg)} "
        f"({'short' if line.difference_kg < 0 else 'over'} {kg(abs(line.difference_kg))})"
        for line in out[:15]
    ]
    notice = Notice(
        title=f"Stock count on {count.count_date:%a %d %b}: {plural(len(out), 'line')} out",
        body=f"Counted by {who}.\n" + "\n".join(lines) + "\nReview it on the Stock count page.",
        link="/stock-count",
        dedupe_key=f"{RECIPE}:diff:{count.id}",
    )
    managers = {u.id for u in actions.team(db, company.id) if actions.is_manager(u)}
    recipients = [i for i in recipient_ids(db, company.id, RECIPE_DEF, rule.recipients or []) if i in managers] or list(
        managers
    )
    deliver(db, company, RECIPE_DEF, [notice], recipients, email=params.email)
    actions.track(db, company, rule, RECIPE_DEF, [notice], now=now_utc())


def _schedule(params: BaseModel) -> Schedule:
    assert isinstance(params, StockCountParams)
    return weekly(MONDAY, time(7, 0)) if params.every == "week" else monthly(1, time(7, 0))


def _reminder(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, StockCountParams)
    since = ctx.local_today - timedelta(days=6 if params.every == "week" else 27)
    last = ctx.db.query(StockCount).order_by(StockCount.count_date.desc()).first()
    if last is not None and last.count_date >= since:
        return []
    when = f"since {last.count_date:%d %B}" if last else "yet"
    return [
        Notice(
            title="Time to count the stock",
            body=(
                f"The stock hasn't been counted {when}. Count it on the Stock count page: "
                "lines out by more than your allowance go to the owner to look at."
            ),
            link="/stock-count",
            dedupe_key=f"{RECIPE}:remind:{ctx.local_today.isoformat()}",
        )
    ]


RECIPE_DEF = Recipe(
    code=RECIPE,
    title="Stock count",
    description=(
        "A reminder to count the stock every week or month, and the owner hears at once when a count "
        "finds lines short or over by more than your allowance."
    ),
    group="stock",
    section="inventory",
    default_roles=("owner", "mill_operator"),
    params=StockCountParams,
    fields=(
        Field("every", "Count every", "select", options=(("week", "Week (Mondays)"), ("month", "Month (the 1st)"))),
        Field("tolerance_pct", "Allow a difference of up to", "percent", "Smaller differences need no review."),
        Field("email", "Also email it", "bool", "It always appears under the bell too."),
    ),
    schedule=_schedule,
    build=_reminder,
)
