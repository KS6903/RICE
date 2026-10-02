"""Owner watch: tell the owner, within 15 minutes, about entries worth a look.

Every recipe here runs on every jobs tick and looks back over the last
LOOKBACK of entries. A notice's dedupe key names the record, and notifications
are unique on (user, dedupe key), so each record is reported once however many
ticks see it. The lookback is longer than any plausible runner outage; on the
day a recipe is switched on it also reports the day before.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, timedelta
from decimal import Decimal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...jobs.schedule import every_tick
from ...models.activity import ActivityLog
from ...models.costs import Expense, ExpenseCategory
from ...models.milling import MillingBatch
from ...models.paddy import PalayPurchase, PalayPurchaseItem
from ...models.reference import RiceVariety
from ...models.sales import PriceList, SalesOrder, SalesOrderItem
from ...models.user import User
from ..base import Field, Notice, Recipe, RecipeContext
from ..format import KG_PER_CAVAN, kg, local_time, percent, peso, peso_exact, plural

LOOKBACK = timedelta(hours=24)

EMAIL_FIELD = Field("email", "Also email it", "bool", "It always appears under the bell too.")


def _since(ctx: RecipeContext):
    return ctx.now - LOOKBACK


def _names(db: Session, user_ids) -> dict[uuid.UUID, User]:
    ids = {i for i in user_ids if i}
    if not ids:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()}


def _by(users: dict[uuid.UUID, User], user_id: uuid.UUID | None) -> str:
    user = users.get(user_id) if user_id else None
    return f" Entered by {user.full_name or user.username}." if user else ""


def _every_tick(_params: BaseModel):
    return every_tick()


# ── big transaction ──────────────────────────────────────────────────────────


class BigTransactionParams(BaseModel):
    sale_over: int = PydanticField(100_000, ge=0, le=100_000_000)
    purchase_over: int = PydanticField(200_000, ge=0, le=100_000_000)
    expense_over: int = PydanticField(20_000, ge=0, le=100_000_000)
    email: bool = True


def _purchase_totals(db: Session, purchase_ids) -> dict[uuid.UUID, tuple[Decimal, Decimal]]:
    """(net kg, peso total) per palay purchase."""
    net_kg = PalayPurchaseItem.gross_weight_kg - PalayPurchaseItem.tare_weight_kg
    rows = (
        db.query(
            PalayPurchaseItem.purchase_id,
            func.sum(net_kg),
            func.sum(net_kg / KG_PER_CAVAN * PalayPurchaseItem.price_per_cavan),
        )
        .filter(PalayPurchaseItem.purchase_id.in_(list(purchase_ids)))
        .group_by(PalayPurchaseItem.purchase_id)
        .all()
    )
    return {pid: (Decimal(weight or 0), Decimal(total or 0)) for pid, weight, total in rows}


def _big_transaction(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, BigTransactionParams)
    db, since = ctx.db, _since(ctx)
    notices: list[Notice] = []

    if params.sale_over:
        orders = (
            db.query(SalesOrder)
            .filter(
                SalesOrder.created_at >= since,
                SalesOrder.status != "cancelled",
                SalesOrder.total_amount >= params.sale_over,
            )
            .order_by(SalesOrder.created_at)
            .all()
        )
        users = _names(db, (o.created_by for o in orders))
        for o in orders:
            customer = o.customer.name if o.customer else "a walk-in customer"
            notices.append(
                Notice(
                    title=f"Big sale: {peso(o.total_amount)}",
                    body=f"{o.order_no} to {customer}, dated {o.order_date:%d %b}.{_by(users, o.created_by)}",
                    link="/sales",
                    dedupe_key=f"big_transaction:sale:{o.id}",
                )
            )

    if params.purchase_over:
        purchases = (
            db.query(PalayPurchase)
            .filter(PalayPurchase.created_at >= since, PalayPurchase.status != "cancelled")
            .order_by(PalayPurchase.created_at)
            .all()
        )
        totals = _purchase_totals(db, (p.id for p in purchases))
        big = [p for p in purchases if totals.get(p.id, (0, 0))[1] >= params.purchase_over]
        users = _names(db, (p.created_by for p in big))
        for p in big:
            weight, total = totals[p.id]
            supplier = p.supplier.name if p.supplier else "an unnamed supplier"
            notices.append(
                Notice(
                    title=f"Big palay purchase: {peso(total)}",
                    body=f"{p.reference_no} from {supplier}, {kg(weight)}.{_by(users, p.created_by)}",
                    link="/paddy",
                    dedupe_key=f"big_transaction:purchase:{p.id}",
                )
            )

    if params.expense_over:
        expenses = (
            db.query(Expense)
            .filter(Expense.created_at >= since, Expense.amount >= params.expense_over)
            .order_by(Expense.created_at)
            .all()
        )
        users = _names(db, (e.created_by for e in expenses))
        for e in expenses:
            what = e.category.name if e.category else "Uncategorised"
            detail = f" {e.description.strip()}." if e.description and e.description.strip() else ""
            notices.append(
                Notice(
                    title=f"Big expense: {peso(e.amount)}",
                    body=f"{what}, dated {e.expense_date:%d %b}.{detail}{_by(users, e.created_by)}",
                    link="/costs",
                    dedupe_key=f"big_transaction:expense:{e.id}",
                )
            )
    return notices


BIG_TRANSACTION = Recipe(
    code="big_transaction",
    title="Big transaction",
    description="A sale, palay purchase or expense over your limit, as soon as it's entered.",
    group="watch",
    section="reports",
    default_roles=("owner",),
    params=BigTransactionParams,
    fields=(
        Field("sale_over", "Sales over", "money", "0 turns this one off."),
        Field("purchase_over", "Palay purchases over", "money", "0 turns this one off."),
        Field("expense_over", "Expenses over", "money", "0 turns this one off."),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_big_transaction,
)


# ── palay price outlier ──────────────────────────────────────────────────────

PRICE_HISTORY_DAYS = 30
MIN_PRICE_SAMPLES = 3


class PalayPriceParams(BaseModel):
    percent: float = PydanticField(10, ge=1, le=100)
    email: bool = True


def _palay_price_outlier(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, PalayPriceParams)
    db = ctx.db
    rows = (
        db.query(PalayPurchaseItem, PalayPurchase)
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(
            PalayPurchase.created_at >= _since(ctx),
            PalayPurchase.status != "cancelled",
            PalayPurchaseItem.variety_id.isnot(None),
        )
        .order_by(PalayPurchase.created_at)
        .all()
    )
    notices: list[Notice] = []
    for item, purchase in rows:
        start = purchase.purchase_date - timedelta(days=PRICE_HISTORY_DAYS)
        avg, samples = (
            db.query(func.avg(PalayPurchaseItem.price_per_cavan), func.count(PalayPurchaseItem.id))
            .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
            .filter(
                PalayPurchaseItem.variety_id == item.variety_id,
                PalayPurchase.id != purchase.id,
                PalayPurchase.status != "cancelled",
                PalayPurchase.purchase_date >= start,
                PalayPurchase.purchase_date <= purchase.purchase_date,
            )
            .one()
        )
        if samples < MIN_PRICE_SAMPLES or not avg:
            continue
        avg = Decimal(avg)
        change = (Decimal(item.price_per_cavan) - avg) / avg * 100
        if abs(change) < Decimal(str(params.percent)):
            continue
        direction = "above" if change > 0 else "below"
        variety = item.variety.name if item.variety else "palay"
        supplier = purchase.supplier.name if purchase.supplier else "an unnamed supplier"
        moisture = f" Moisture {item.moisture_content_pct:.0f}%." if item.moisture_content_pct is not None else ""
        notices.append(
            Notice(
                title=f"Palay bought {abs(change):.0f}% {direction} normal",
                body=(
                    f"{purchase.reference_no} from {supplier}: {variety} at "
                    f"{peso(item.price_per_cavan)} a cavan. The last {PRICE_HISTORY_DAYS} days averaged "
                    f"{peso(avg)} over {plural(samples, 'purchase')}.{moisture}"
                ),
                link="/paddy",
                dedupe_key=f"palay_price_outlier:{item.id}",
            )
        )
    return notices


PALAY_PRICE_OUTLIER = Recipe(
    code="palay_price_outlier",
    title="Unusual palay price",
    description="A palay purchase priced well above or below what you've paid for that variety this month.",
    group="watch",
    section="reports",
    default_roles=("owner",),
    params=PalayPriceParams,
    fields=(
        Field("percent", "Tell me when the price is off by", "percent", "Compared with the last 30 days."),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_palay_price_outlier,
)


# ── after-the-fact edit ──────────────────────────────────────────────────────

_UUID = r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
# The dated records that can be edited after they're entered, by the API path
# the edit was made through (as the mutation audit records it).
_EDITABLE: tuple[tuple[re.Pattern[str], type[PalayPurchase] | type[SalesOrder], str, str, str], ...] = (
    (re.compile(rf"^/api/paddy/purchases/{_UUID}$"), PalayPurchase, "reference_no", "palay purchase", "/paddy"),
    (re.compile(rf"^/api/sales/orders/{_UUID}$"), SalesOrder, "order_no", "sales order", "/sales"),
)
_SUCCESS = re.compile(r"\bstatus=2\d\d\b")


class LateEditParams(BaseModel):
    older_than_hours: int = PydanticField(24, ge=1, le=24 * 60)
    email: bool = True


def _late_edit(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, LateEditParams)
    db = ctx.db
    logs = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.created_at >= _since(ctx),
            ActivityLog.action.in_(("api.put", "api.patch", "api.delete")),
        )
        .order_by(ActivityLog.created_at)
        .all()
    )
    users = _names(db, (log.user_id for log in logs))
    notices: list[Notice] = []
    for log in logs:
        if not _SUCCESS.search(log.detail or ""):
            continue
        editor = users.get(log.user_id) if log.user_id else None
        # The owner's own corrections aren't news to the owner.
        if editor is not None and editor.role is not None and editor.role.name == "owner":
            continue
        for pattern, model, number_attr, noun, link in _EDITABLE:
            match = pattern.match(log.entity_label or "")
            if not match:
                continue
            record_id = uuid.UUID(match.group(1))
            record: PalayPurchase | SalesOrder | None = (
                db.get(PalayPurchase, record_id) if model is PalayPurchase else db.get(SalesOrder, record_id)
            )
            if record is None or record.created_at is None:
                break
            age = log.created_at - record.created_at
            if age < timedelta(hours=params.older_than_hours):
                break
            who = (editor.full_name or editor.username) if editor else "Someone"
            verb = "deleted" if log.action == "api.delete" else "changed"
            days = age.days
            ago = plural(days, "day") if days >= 1 else plural(int(age.total_seconds() // 3600), "hour")
            notices.append(
                Notice(
                    title=f"Old {noun} {verb}: {getattr(record, number_attr)}",
                    body=(
                        f"{who} {verb} {getattr(record, number_attr)} on {local_time(log.created_at, ctx.zone)}, "
                        f"{ago} after it was entered."
                    ),
                    link=link,
                    dedupe_key=f"late_edit:{log.id}",
                )
            )
            break
    return notices


LATE_EDIT = Recipe(
    code="late_edit",
    title="Old records changed",
    description="Someone changes a palay purchase or sales order long after it was entered.",
    group="watch",
    section="reports",
    default_roles=("owner",),
    params=LateEditParams,
    fields=(
        Field("older_than_hours", "Records older than", "number", "Your own changes are left out.", unit="hours"),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_late_edit,
)


# ── big discount ─────────────────────────────────────────────────────────────


class BigDiscountParams(BaseModel):
    percent: float = PydanticField(5, ge=0.5, le=100)
    email: bool = True


def _big_discount(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, BigDiscountParams)
    db = ctx.db
    orders = (
        db.query(SalesOrder)
        .filter(
            SalesOrder.created_at >= _since(ctx),
            SalesOrder.status != "cancelled",
            SalesOrder.discount_pct >= params.percent,
            SalesOrder.discount_amount > 0,
        )
        .order_by(SalesOrder.created_at)
        .all()
    )
    users = _names(db, (o.created_by for o in orders))
    return [
        Notice(
            title=f"{percent(o.discount_pct)} discount on {o.order_no}",
            body=(
                f"{o.customer.name if o.customer else 'A walk-in customer'}: {peso(o.discount_amount)} off "
                f"{peso(o.subtotal)}.{_by(users, o.created_by)}"
            ),
            link="/sales",
            dedupe_key=f"big_discount:{o.id}",
        )
        for o in orders
    ]


BIG_DISCOUNT = Recipe(
    code="big_discount",
    title="Big discount",
    description="A sales order given a discount at or over your limit.",
    group="watch",
    section="reports",
    default_roles=("owner",),
    params=BigDiscountParams,
    fields=(Field("percent", "Discounts of at least", "percent"), EMAIL_FIELD),
    schedule=_every_tick,
    build=_big_discount,
)


# ── sold below the price list ────────────────────────────────────────────────


class BelowPriceParams(BaseModel):
    percent: float = PydanticField(3, ge=0, le=50)
    email: bool = True


def _per_kg(price: PriceList) -> Decimal | None:
    if price.price_per_kg is not None:
        return Decimal(price.price_per_kg)
    for per_50kg in (price.price_per_sack_50kg, price.price_per_cavan):
        if per_50kg is not None:
            return Decimal(per_50kg) / KG_PER_CAVAN
    return None


def list_price(
    prices: list[PriceList], variety_id, grade_name: str | None, customer_type: str | None, on: date
) -> Decimal | None:
    """The price list's price per kg for this rice, to this kind of customer, on
    that day. The most specific entry wins: one for the customer type over a
    general one, one for the grade over a general one, then the newest."""
    best: tuple[tuple[int, int, date], Decimal] | None = None
    for p in prices:
        if p.variety_id != variety_id or not p.is_active:
            continue
        if p.effective_date > on or (p.expiry_date is not None and p.expiry_date < on):
            continue
        if p.grade_name and p.grade_name != grade_name:
            continue
        if p.customer_type and p.customer_type != customer_type:
            continue
        per_kg = _per_kg(p)
        if per_kg is None:
            continue
        rank = (1 if p.customer_type else 0, 1 if p.grade_name else 0, p.effective_date)
        if best is None or rank > best[0]:
            best = (rank, per_kg)
    return best[1] if best else None


def _below_price_list(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, BelowPriceParams)
    db = ctx.db
    orders = (
        db.query(SalesOrder)
        .filter(SalesOrder.created_at >= _since(ctx), SalesOrder.status != "cancelled")
        .order_by(SalesOrder.created_at)
        .all()
    )
    if not orders:
        return []
    prices = db.query(PriceList).filter(PriceList.is_active.is_(True)).all()
    if not prices:
        return []
    varieties = {v.id: v.name for v in db.query(RiceVariety).all()}
    users = _names(db, (o.created_by for o in orders))
    threshold = 1 - Decimal(str(params.percent)) / 100
    notices: list[Notice] = []
    for order in orders:
        customer_type = order.customer.customer_type if order.customer else None
        lines = []
        for item in db.query(SalesOrderItem).filter(SalesOrderItem.order_id == order.id).all():
            if item.item_type != "milled_rice" or item.variety_id is None:
                continue
            listed = list_price(prices, item.variety_id, item.grade_name, customer_type, order.order_date)
            if listed is None or Decimal(item.unit_price_per_kg) >= listed * threshold:
                continue
            under = (listed - Decimal(item.unit_price_per_kg)) / listed * 100
            rice = " ".join(x for x in (varieties.get(item.variety_id), item.grade_name) if x) or "Rice"
            lines.append(
                f"{rice}, {kg(item.quantity_kg)}: {peso_exact(item.unit_price_per_kg)}/kg, "
                f"list {peso_exact(listed)}/kg ({under:.0f}% under)"
            )
        if lines:
            customer = order.customer.name if order.customer else "a walk-in customer"
            notices.append(
                Notice(
                    title=f"{order.order_no} sold below your price list",
                    body=f"To {customer}.{_by(users, order.created_by)}\n" + "\n".join(lines),
                    link="/sales",
                    dedupe_key=f"below_price_list:{order.id}",
                )
            )
    return notices


BELOW_PRICE_LIST = Recipe(
    code="below_price_list",
    title="Sold below price list",
    description="Rice sold for less than your price list says, beyond a small allowance.",
    group="watch",
    section="reports",
    default_roles=("owner",),
    params=BelowPriceParams,
    fields=(
        Field("percent", "Allow up to", "percent", "Sales this far under the list are fine."),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_below_price_list,
)


# ── cancellations ────────────────────────────────────────────────────────────


class CancellationParams(BaseModel):
    email: bool = True


def _cancellations(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    db, since = ctx.db, _since(ctx)
    notices: list[Notice] = []
    for o in db.query(SalesOrder).filter(SalesOrder.status == "cancelled", SalesOrder.updated_at >= since).all():
        customer = o.customer.name if o.customer else "a walk-in customer"
        notices.append(
            Notice(
                title=f"Sales order cancelled: {o.order_no}",
                body=f"{peso(o.total_amount)} to {customer}, dated {o.order_date:%d %b}.",
                link="/sales",
                dedupe_key=f"cancellations:sale:{o.id}",
            )
        )
    purchases = (
        db.query(PalayPurchase).filter(PalayPurchase.status == "cancelled", PalayPurchase.updated_at >= since).all()
    )
    totals = _purchase_totals(db, (p.id for p in purchases))
    for p in purchases:
        weight, total = totals.get(p.id, (Decimal(0), Decimal(0)))
        supplier = p.supplier.name if p.supplier else "an unnamed supplier"
        notices.append(
            Notice(
                title=f"Palay purchase cancelled: {p.reference_no}",
                body=f"{kg(weight)} for {peso(total)} from {supplier}, dated {p.purchase_date:%d %b}.",
                link="/paddy",
                dedupe_key=f"cancellations:purchase:{p.id}",
            )
        )
    for b in db.query(MillingBatch).filter(MillingBatch.status == "cancelled", MillingBatch.updated_at >= since).all():
        notices.append(
            Notice(
                title=f"Milling batch cancelled: {b.batch_no}",
                body=f"Started {local_time(b.start_datetime, ctx.zone)}.",
                link="/milling",
                dedupe_key=f"cancellations:batch:{b.id}",
            )
        )
    return notices


CANCELLATIONS = Recipe(
    code="cancellations",
    title="Cancellations",
    description="A sales order, palay purchase or milling batch is cancelled.",
    group="watch",
    section="reports",
    default_roles=("owner",),
    params=CancellationParams,
    fields=(EMAIL_FIELD,),
    schedule=_every_tick,
    build=_cancellations,
)


# ── unusual expense ──────────────────────────────────────────────────────────

EXPENSE_HISTORY_DAYS = 90
MIN_EXPENSE_SAMPLES = 5


class UnusualExpenseParams(BaseModel):
    times: float = PydanticField(3, ge=1.5, le=50)
    email: bool = True


def _unusual_expense(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, UnusualExpenseParams)
    db = ctx.db
    expenses = (
        db.query(Expense)
        .filter(Expense.created_at >= _since(ctx), Expense.category_id.isnot(None))
        .order_by(Expense.created_at)
        .all()
    )
    users = _names(db, (e.created_by for e in expenses))
    categories = {c.id: c.name for c in db.query(ExpenseCategory).all()}
    notices: list[Notice] = []
    for e in expenses:
        avg, samples = (
            db.query(func.avg(Expense.amount), func.count(Expense.id))
            .filter(
                Expense.category_id == e.category_id,
                Expense.id != e.id,
                Expense.expense_date >= e.expense_date - timedelta(days=EXPENSE_HISTORY_DAYS),
                Expense.expense_date <= e.expense_date,
            )
            .one()
        )
        if samples < MIN_EXPENSE_SAMPLES or not avg:
            continue
        ratio = Decimal(e.amount) / Decimal(avg)
        if ratio < Decimal(str(params.times)):
            continue
        category = categories.get(e.category_id, "this category") if e.category_id else "this category"
        detail = f" {e.description.strip()}." if e.description and e.description.strip() else ""
        notices.append(
            Notice(
                title=f"Unusual expense: {peso(e.amount)} for {category}",
                body=(
                    f"That's {ratio:.1f}× the usual {peso(avg)} for {category} over the last "
                    f"{EXPENSE_HISTORY_DAYS} days.{detail}{_by(users, e.created_by)}"
                ),
                link="/costs",
                dedupe_key=f"unusual_expense:{e.id}",
            )
        )
    return notices


UNUSUAL_EXPENSE = Recipe(
    code="unusual_expense",
    title="Unusual expense",
    description="An expense far bigger than what that category usually costs.",
    group="watch",
    section="reports",
    default_roles=("owner",),
    params=UnusualExpenseParams,
    fields=(
        Field("times", "Tell me at", "number", "Compared with the last 90 days in that category.", unit="× usual"),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_unusual_expense,
)


WATCH_RECIPES = (
    BIG_TRANSACTION,
    PALAY_PRICE_OUTLIER,
    LATE_EDIT,
    BIG_DISCOUNT,
    BELOW_PRICE_LIST,
    CANCELLATIONS,
    UNUSUAL_EXPENSE,
)
