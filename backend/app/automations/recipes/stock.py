"""Stock and warehouse: running low, getting old, overloaded, or rain on the way.

Apart from the rain warning these are conditions that last for days, so they
are checked every morning and reported when they start (automations.state):
rice that is still low tomorrow isn't news, rice that runs low again next
month is.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import func

from ...jobs.schedule import Schedule, daily
from ...models.company import Branch
from ...models.milling import ByproductInventory, MilledRiceInventory, MillingBatch, MillingBatchInput
from ...models.paddy import PalayInventory
from ...models.reference import RiceVariety
from ...models.sales import SalesOrder, SalesOrderItem
from ...models.user_location import UserLocation
from ...models.warehouse import Pallet, RiceBatch, WarehouseLayout, WarehouseZone
from ...services.rice_shelf_life import compute_best_before
from ..base import Field, Notice, Recipe, RecipeContext, RecipeProblem
from ..format import kg, plural, rice_name
from ..sources import saved_locations
from ..state import newly_true
from .watch import EMAIL_FIELD

MORNING = time(7, 0)
PACE_DAYS = 30


def _each_morning(_params: BaseModel) -> Schedule:
    return daily(MORNING)


def _variety_names(ctx: RecipeContext) -> dict[uuid.UUID | None, str]:
    return {v.id: v.name for v in ctx.db.query(RiceVariety).all()}


def _branch_names(ctx: RecipeContext) -> dict[uuid.UUID, str]:
    return {b.id: b.name for b in ctx.db.query(Branch).filter(Branch.company_id == ctx.company.id).all()}


# ── low stock ────────────────────────────────────────────────────────────────


def _cover_line(what: str, left: Decimal, per_day: Decimal, verb: str) -> str:
    if left <= 0:
        return f"{what}: none left. You've {verb} about {kg(per_day)} a day this past month."
    days = int(left / per_day)
    pace = "less than a day" if days < 1 else f"about {plural(days, 'day')}"
    return f"{what}: {kg(left)} left, {pace} at your usual pace"


class LowStockParams(BaseModel):
    days: int = PydanticField(7, ge=1, le=90)
    email: bool = True


def _low_stock(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    """Days of cover: what's in stock over what the mill has used per day this
    past month. Something nobody sold or milled lately is never 'low'."""
    assert isinstance(params, LowStockParams)
    db = ctx.db
    since = ctx.local_today - timedelta(days=PACE_DAYS)
    names = _variety_names(ctx)
    low: dict[str, str] = {}

    rice_stock: dict[tuple, Decimal] = defaultdict(Decimal)
    for variety_id, grade, qty in db.query(
        MilledRiceInventory.variety_id, MilledRiceInventory.grade_name, MilledRiceInventory.quantity_kg
    ).all():
        rice_stock[(variety_id, grade)] += Decimal(qty or 0)
    sold = (
        db.query(SalesOrderItem.variety_id, SalesOrderItem.grade_name, func.sum(SalesOrderItem.quantity_kg))
        .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id)
        .filter(
            SalesOrderItem.item_type == "milled_rice",
            SalesOrder.order_date >= since,
            SalesOrder.status.notin_(("draft", "cancelled")),
        )
        .group_by(SalesOrderItem.variety_id, SalesOrderItem.grade_name)
        .all()
    )
    for variety_id, grade, qty in sold:
        per_day = Decimal(qty or 0) / PACE_DAYS
        left = rice_stock.get((variety_id, grade), Decimal(0))
        if per_day > 0 and left / per_day < params.days:
            low[f"rice:{variety_id}:{grade}"] = _cover_line(
                f"{rice_name(names.get(variety_id), grade)} rice", left, per_day, "sold"
            )

    palay_stock: dict[uuid.UUID | None, Decimal] = defaultdict(Decimal)
    for variety_id, qty in db.query(PalayInventory.variety_id, PalayInventory.quantity_kg).all():
        palay_stock[variety_id] += Decimal(qty or 0)
    start = datetime.combine(since, time(0, 0), tzinfo=ctx.zone)
    milled = (
        db.query(MillingBatchInput.variety_id, func.sum(MillingBatchInput.input_weight_kg))
        .join(MillingBatch, MillingBatch.id == MillingBatchInput.batch_id)
        .filter(MillingBatch.start_datetime >= start, MillingBatch.status != "cancelled")
        .group_by(MillingBatchInput.variety_id)
        .all()
    )
    for variety_id, qty in milled:
        per_day = Decimal(qty or 0) / PACE_DAYS
        left = palay_stock.get(variety_id, Decimal(0))
        if per_day > 0 and left / per_day < params.days:
            low[f"palay:{variety_id}"] = _cover_line(
                f"{names.get(variety_id, 'Unnamed')} palay", left, per_day, "milled"
            )

    new = sorted(newly_true(ctx, "low_stock", low))
    if not new:
        return []
    return [
        Notice(
            title=f"Running low: {plural(len(new), 'item')}",
            body="\n".join(low[key] for key in new),
            link="/inventory",
            dedupe_key=f"low_stock:{ctx.local_today.isoformat()}",
        )
    ]


LOW_STOCK = Recipe(
    code="low_stock",
    title="Running low",
    description="Rice or palay that will run out within days at the pace you've been selling and milling.",
    group="stock",
    section="inventory",
    default_roles=("owner", "mill_operator"),
    params=LowStockParams,
    fields=(
        Field(
            "days",
            "Tell me when there's less than",
            "number",
            "Checked at 7 in the morning. Each item is reported once until it's restocked.",
            unit="days left",
        ),
        EMAIL_FIELD,
    ),
    schedule=_each_morning,
    build=_low_stock,
)


# ── shelf life ───────────────────────────────────────────────────────────────


class ShelfLifeParams(BaseModel):
    warn_days: int = PydanticField(14, ge=1, le=90)
    email: bool = True


def _shelf_life(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, ShelfLifeParams)
    db = ctx.db
    today = ctx.local_today
    names = _variety_names(ctx)
    rows = (
        db.query(RiceBatch, Pallet.pallet_code)
        .join(Pallet, Pallet.id == RiceBatch.pallet_id)
        .join(WarehouseLayout, WarehouseLayout.id == Pallet.layout_id)
        .filter(Pallet.status == "in_storage", WarehouseLayout.deleted_at.is_(None))
        .all()
    )
    found: dict[str, tuple[int, str]] = {}
    for batch, pallet_code in rows:
        best_before = batch.best_before_date or compute_best_before(batch.milling_date, batch.moisture_pct)
        days_left = (best_before - today).days
        if days_left > params.warn_days:
            continue
        stage = "expired" if days_left < 0 else "soon"
        rice = names.get(batch.variety_id, "Rice") if batch.variety_id else "Rice"
        when = f"{plural(-days_left, 'day')} past best-before" if days_left < 0 else f"best before {best_before:%d %b}"
        # The stage is in the key: rice reported as "soon" is reported again
        # when it actually expires.
        found[f"{batch.id}:{stage}"] = (
            days_left,
            f"Pallet {pallet_code}: {rice}, {plural(batch.sack_count, 'sack')}, {when}",
        )
    new = sorted(newly_true(ctx, "shelf_life", found), key=lambda k: found[k][0])
    if not new:
        return []
    expired = sum(1 for key in new if key.endswith(":expired"))
    parts = []
    if expired:
        parts.append(f"{plural(expired, 'batch', 'batches')} past best-before")
    if len(new) > expired:
        parts.append(f"{plural(len(new) - expired, 'batch', 'batches')} nearly there")
    return [
        Notice(
            title="Rice getting old: " + ", ".join(parts),
            body="\n".join(found[key][1] for key in new) + "\nSell or use these first.",
            link="/inventory",
            dedupe_key=f"shelf_life:{today.isoformat()}",
        )
    ]


SHELF_LIFE = Recipe(
    code="shelf_life",
    title="Rice getting old",
    description="Rice in your warehouse that is near or past its best-before date.",
    group="stock",
    section="inventory",
    default_roles=("owner", "mill_operator"),
    params=ShelfLifeParams,
    fields=(
        Field("warn_days", "Warn me this long before best-before", "number", unit="days"),
        EMAIL_FIELD,
    ),
    schedule=_each_morning,
    build=_shelf_life,
)


# ── rain warning ─────────────────────────────────────────────────────────────

RAIN_FROM = time(5, 0)
RAIN_UNTIL = time(10, 0)  # a warning for today is no use after mid-morning
DRYING_HOURS = range(6, 18)  # 06:00 to 17:59, local


class RainParams(BaseModel):
    location_id: str = ""
    chance: int = PydanticField(60, ge=10, le=100)
    email: bool = True


def _rain_schedule(_params: BaseModel) -> Schedule:
    def due(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        return local.date().isoformat() if RAIN_FROM <= local.time() < RAIN_UNTIL else None

    return due


def _location(ctx: RecipeContext, location_id: str) -> UserLocation:
    locations = saved_locations(ctx.db, ctx.company.id)
    if not locations:
        raise RecipeProblem("No saved location yet. Save your mill's location on the weather card first.")
    if not location_id:
        return locations[0]
    for loc in locations:
        if str(loc.id) == location_id:
            return loc
    raise RecipeProblem("The location this warning used was deleted. Pick another one in its settings.")


def _forecast(lat: float, lon: float) -> dict:
    from ...services.weather import WeatherService

    return WeatherService().get_forecast(None, lat, lon)  # type: ignore[arg-type]


def rain_windows(hourly: list[dict], day: date, chance: int) -> list[tuple[int, int, int]]:
    """Runs of drying-hours on ``day`` with at least ``chance``% rain, as
    (first hour, last hour, highest chance)."""
    windows: list[list[int]] = []
    for h in hourly:
        try:
            at = datetime.fromisoformat(h["time"])
        except (KeyError, TypeError, ValueError):
            continue
        pct = h.get("precip_pct")
        if at.date() != day or at.hour not in DRYING_HOURS or pct is None or pct < chance:
            continue
        if windows and windows[-1][1] == at.hour - 1:
            windows[-1][1] = at.hour
            windows[-1][2] = max(windows[-1][2], pct)
        else:
            windows.append([at.hour, at.hour, pct])
    return [(a, b, c) for a, b, c in windows]


def _rain_warning(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, RainParams)
    loc = _location(ctx, params.location_id)
    forecast = _forecast(float(loc.lat), float(loc.lon))
    windows = rain_windows(forecast.get("hourly") or [], ctx.local_today, params.chance)
    if not windows:
        return []
    spans = ", ".join(f"{a:02d}:00 to {b + 1:02d}:00 (up to {c}%)" for a, b, c in windows)
    first = windows[0][0]
    return [
        Notice(
            title=f"Rain likely today at {loc.label}",
            body=(f"Rain expected {spans}. Don't spread palay to dry, or bring it in before {first:02d}:00."),
            link="/paddy",
            dedupe_key=f"rain_warning:{ctx.local_today.isoformat()}",
        )
    ]


RAIN_WARNING = Recipe(
    code="rain_warning",
    title="Rain warning for drying",
    description="Early in the morning, a warning if rain is likely while palay would be out drying.",
    group="stock",
    section="paddy",
    default_roles=("owner", "mill_operator"),
    params=RainParams,
    fields=(
        Field(
            "location_id",
            "Where",
            "select",
            "The places saved on your weather card.",
            options=(("", "The first saved location"),),
            options_from="saved_locations",
        ),
        Field("chance", "Warn at a rain chance of", "percent", "Checked at 5 in the morning."),
        EMAIL_FIELD,
    ),
    schedule=_rain_schedule,
    build=_rain_warning,
)


# ── zone over its weight limit ───────────────────────────────────────────────


class ZoneParams(BaseModel):
    email: bool = True


def _zone_overweight(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    db = ctx.db
    rows = (
        db.query(WarehouseZone, WarehouseLayout.name, func.sum(Pallet.weight_kg))
        .join(WarehouseLayout, WarehouseLayout.id == WarehouseZone.layout_id)
        .join(Pallet, (Pallet.zone_id == WarehouseZone.id) & (Pallet.status == "in_storage"))
        .filter(WarehouseZone.max_weight_kg > 0, WarehouseLayout.deleted_at.is_(None))
        .group_by(WarehouseZone.id, WarehouseLayout.name)
        .all()
    )
    over = {
        str(zone.id): (
            f"{zone.name} ({layout}): {kg(load)} on a {kg(zone.max_weight_kg)} limit "
            f"({Decimal(load) / Decimal(zone.max_weight_kg) * 100:.0f}%)"
        )
        for zone, layout, load in rows
        if load is not None and Decimal(load) > Decimal(zone.max_weight_kg)
    }
    new = sorted(newly_true(ctx, "zone_overweight", over))
    if not new:
        return []
    return [
        Notice(
            title=f"Warehouse zone over its limit: {plural(len(new), 'zone')}",
            body="\n".join(over[key] for key in new) + "\nMove some pallets before the floor or racks suffer.",
            link="/inventory",
            dedupe_key=f"zone_overweight:{ctx.local_today.isoformat()}",
        )
    ]


ZONE_OVERWEIGHT = Recipe(
    code="zone_overweight",
    title="Zone over its weight limit",
    description="A warehouse zone holding more than the weight limit you set for it.",
    group="stock",
    section="inventory",
    default_roles=("owner", "mill_operator"),
    params=ZoneParams,
    fields=(EMAIL_FIELD,),
    schedule=_each_morning,
    build=_zone_overweight,
)


# ── stock below zero ─────────────────────────────────────────────────────────


class NegativeStockParams(BaseModel):
    email: bool = True


def _negative_stock(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    db = ctx.db
    names = _variety_names(ctx)
    branches = _branch_names(ctx)

    def where(branch_id) -> str:
        return f" at {branches[branch_id]}" if len(branches) > 1 and branch_id in branches else ""

    below: dict[str, str] = {}
    for rice_row in db.query(MilledRiceInventory).filter(MilledRiceInventory.quantity_kg < 0).all():
        rice = rice_name(names.get(rice_row.variety_id), rice_row.grade_name)
        below[f"rice:{rice_row.id}"] = f"{rice} rice: {kg(rice_row.quantity_kg)}{where(rice_row.branch_id)}"
    for palay_row in db.query(PalayInventory).filter(PalayInventory.quantity_kg < 0).all():
        below[f"palay:{palay_row.id}"] = (
            f"{names.get(palay_row.variety_id, 'Unnamed')} palay: "
            f"{kg(palay_row.quantity_kg)}{where(palay_row.branch_id)}"
        )
    for by_row in db.query(ByproductInventory).filter(ByproductInventory.quantity_kg < 0).all():
        below[f"byproduct:{by_row.id}"] = (
            f"{by_row.byproduct_type.replace('_', ' ').capitalize()}: {kg(by_row.quantity_kg)}{where(by_row.branch_id)}"
        )
    new = sorted(newly_true(ctx, "negative_stock", below))
    if not new:
        return []
    return [
        Notice(
            title=f"Stock below zero: {plural(len(new), 'item')}",
            body=(
                "\n".join(below[key] for key in new)
                + "\nUsually a sale or milling batch was entered before the stock it used. "
                "Correct it with a stock adjustment."
            ),
            link="/inventory",
            dedupe_key=f"negative_stock:{ctx.local_today.isoformat()}",
        )
    ]


NEGATIVE_STOCK = Recipe(
    code="negative_stock",
    title="Stock below zero",
    description="Stock the app shows as less than nothing, which means an entry is wrong.",
    group="stock",
    section="inventory",
    default_roles=("owner",),
    params=NegativeStockParams,
    fields=(EMAIL_FIELD,),
    schedule=_each_morning,
    build=_negative_stock,
)


STOCK_RECIPES = (LOW_STOCK, SHELF_LIFE, RAIN_WARNING, ZONE_OVERWEIGHT, NEGATIVE_STOCK)
