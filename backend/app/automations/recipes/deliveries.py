"""Deliveries: orders that are late, or due tomorrow with no truck yet."""

from __future__ import annotations

from datetime import time, timedelta

from pydantic import BaseModel

from ...jobs.schedule import Schedule, daily
from ...models.fleet import DispatchTrip
from ...models.sales import SalesOrder
from ..base import Notice, Recipe, RecipeContext
from ..format import peso, plural
from ..state import newly_true
from .watch import EMAIL_FIELD

# Orders in these states won't be delivered (or already were).
_NOT_PENDING = ("draft", "cancelled", "delivered")


def _customer(o: SalesOrder) -> str:
    return o.customer.name if o.customer else "a walk-in customer"


# ── late deliveries ──────────────────────────────────────────────────────────


class LateDeliveryParams(BaseModel):
    email: bool = True


def _late_deliveries(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    today = ctx.local_today
    orders = (
        ctx.db.query(SalesOrder)
        .filter(
            SalesOrder.delivery_date < today,
            SalesOrder.delivery_date >= today - timedelta(days=60),
            SalesOrder.delivered_at.is_(None),
            SalesOrder.status.notin_(_NOT_PENDING),
        )
        .order_by(SalesOrder.delivery_date)
        .all()
    )
    late = {str(o.id): o for o in orders}
    new = newly_true(ctx, "late_deliveries", late)
    if not new:
        return []
    due = sorted(
        ((o.delivery_date, o.order_no, o) for o in (late[k] for k in new) if o.delivery_date is not None),
        key=lambda t: (t[0], t[1]),
    )
    lines = [
        f"{o.order_no}, {_customer(o)}: due {day:%a %d %b}, {plural((today - day).days, 'day')} late"
        for day, _, o in due
    ]
    return [
        Notice(
            title=f"Late deliveries: {plural(len(lines), 'order')}",
            body="\n".join(lines) + "\nMark them delivered on the dispatch board once they arrive.",
            link="/dispatch",
            dedupe_key=f"late_deliveries:{today.isoformat()}",
        )
    ]


LATE_DELIVERIES = Recipe(
    code="late_deliveries",
    title="Late deliveries",
    description="Each morning, orders past their delivery date that aren't marked delivered. Each is named once.",
    group="deliveries",
    section="dispatch",
    default_roles=("owner", "mill_operator"),
    params=LateDeliveryParams,
    fields=(EMAIL_FIELD,),
    schedule=lambda _params: daily(time(8, 0)),
    build=_late_deliveries,
)


# ── tomorrow's deliveries with no truck ──────────────────────────────────────

AFTERNOON = time(15, 0)


class NoTruckParams(BaseModel):
    email: bool = True


def _afternoon(_params: BaseModel) -> Schedule:
    return daily(AFTERNOON)


def _no_truck(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    tomorrow = ctx.local_today + timedelta(days=1)
    has_trip = (
        ctx.db.query(DispatchTrip.id)
        .filter(DispatchTrip.order_id == SalesOrder.id, DispatchTrip.status != "cancelled")
        .exists()
    )
    orders = (
        ctx.db.query(SalesOrder)
        .filter(
            SalesOrder.delivery_date == tomorrow,
            SalesOrder.delivered_at.is_(None),
            SalesOrder.status.notin_(_NOT_PENDING),
            ~has_trip,
        )
        .order_by(SalesOrder.order_no)
        .all()
    )
    if not orders:
        return []
    return [
        Notice(
            title=f"No truck yet for tomorrow: {plural(len(orders), 'order')}",
            body="\n".join(f"{o.order_no}, {_customer(o)}: {peso(o.total_amount)}" for o in orders)
            + "\nAssign a truck and driver on the dispatch board.",
            link="/dispatch",
            dedupe_key=f"no_truck:{tomorrow.isoformat()}",
        )
    ]


NO_TRUCK = Recipe(
    code="no_truck",
    title="Tomorrow's deliveries with no truck",
    description="At 3 in the afternoon, orders due for delivery tomorrow that have no trip planned yet.",
    group="deliveries",
    section="dispatch",
    default_roles=("owner", "mill_operator"),
    params=NoTruckParams,
    fields=(EMAIL_FIELD,),
    schedule=_afternoon,
    build=_no_truck,
)


DELIVERY_RECIPES = (LATE_DELIVERIES, NO_TRUCK)
