"""Milling and drying: batches and palay that need someone's attention.

These run every jobs tick and report each batch, purchase item or drying
record once (the dedupe key names it), like the owner-watch recipes.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import func

from ...models.milling import MillingBatch, MillingBatchInput, MillingBatchOutput
from ...models.paddy import DryingRecord, PalayPurchase, PalayPurchaseItem
from ...models.reference import RiceVariety
from ...models.user import User
from ..base import Field, Notice, Recipe, RecipeContext
from ..format import kg, local_time, plural
from .watch import EMAIL_FIELD, LOOKBACK, _every_tick

# Unfinished work older than this is abandoned data, not news.
STALE_AFTER = timedelta(days=60)


def _hours_ago(ctx: RecipeContext, at) -> str:
    hours = int((ctx.now - at).total_seconds() // 3600)
    return plural(hours // 24, "day") if hours >= 48 else plural(hours, "hour")


# ── poor milling batch ───────────────────────────────────────────────────────


class MillingQualityParams(BaseModel):
    expected_recovery: float = PydanticField(63, ge=40, le=80)
    allowance: float = PydanticField(3, ge=0, le=20)
    broken_over: float = PydanticField(15, ge=1, le=60)
    email: bool = True


def expected_recovery(inputs: list[tuple[Decimal, Decimal | None]], fallback: Decimal) -> Decimal:
    """The batch's expected milled-rice recovery: each input variety's typical
    recovery (or the mill's own figure when the variety has none), weighted by
    how much of it went in."""
    total = sum((weight for weight, _ in inputs), Decimal(0))
    if not total:
        return fallback
    return (
        sum((weight * (typical if typical is not None else fallback) for weight, typical in inputs), Decimal(0)) / total
    )


def _milling_quality(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, MillingQualityParams)
    db = ctx.db
    batches = (
        db.query(MillingBatch)
        .filter(MillingBatch.status == "completed", MillingBatch.end_datetime >= ctx.now - LOOKBACK)
        .order_by(MillingBatch.end_datetime)
        .all()
    )
    fallback = Decimal(str(params.expected_recovery))
    notices: list[Notice] = []
    for batch in batches:
        inputs = [
            (Decimal(weight), Decimal(typical) if typical is not None else None)
            for weight, typical in db.query(MillingBatchInput.input_weight_kg, RiceVariety.typical_recovery_pct)
            .outerjoin(RiceVariety, RiceVariety.id == MillingBatchInput.variety_id)
            .filter(MillingBatchInput.batch_id == batch.id)
            .all()
        ]
        milled, broken_weighted, broken_kg = (
            db.query(
                func.sum(MillingBatchOutput.output_weight_kg),
                func.sum(MillingBatchOutput.broken_rice_pct * MillingBatchOutput.output_weight_kg),
                func.sum(MillingBatchOutput.output_weight_kg).filter(MillingBatchOutput.broken_rice_pct.isnot(None)),
            )
            .filter(MillingBatchOutput.batch_id == batch.id, MillingBatchOutput.output_type == "milled_rice")
            .one()
        )
        input_kg = sum((weight for weight, _ in inputs), Decimal(0))
        problems = []
        if input_kg and milled is not None:
            recovery = Decimal(milled) / input_kg * 100
            expected = expected_recovery(inputs, fallback)
            if recovery < expected - Decimal(str(params.allowance)):
                problems.append(
                    f"Recovery {recovery:.1f}%: {kg(milled)} of rice from {kg(input_kg)} of palay. "
                    f"Expected about {expected:.0f}%."
                )
        if broken_kg:
            broken = Decimal(broken_weighted) / Decimal(broken_kg)
            if broken > Decimal(str(params.broken_over)):
                problems.append(f"Broken rice {broken:.0f}%, over your {params.broken_over:g}% limit.")
        if not problems:
            continue
        operator = db.get(User, batch.operator_id) if batch.operator_id else None
        who = f"\nOperator: {operator.full_name or operator.username}." if operator else ""
        notices.append(
            Notice(
                title=f"Poor milling batch: {batch.batch_no}",
                body="\n".join(problems) + who,
                link="/milling",
                dedupe_key=f"milling_quality:{batch.id}",
            )
        )
    return notices


MILLING_QUALITY = Recipe(
    code="milling_quality",
    title="Poor milling batch",
    description="A finished batch with low rice recovery or too much broken rice.",
    group="production",
    section="milling",
    default_roles=("owner",),
    params=MillingQualityParams,
    fields=(
        Field(
            "expected_recovery",
            "Usual recovery",
            "percent",
            "Used for varieties that don't have their own typical recovery set.",
        ),
        Field("allowance", "Tell me when recovery is under that by", "number", unit="points"),
        Field("broken_over", "Or broken rice is over", "percent"),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_milling_quality,
)


# ── wet palay not drying ─────────────────────────────────────────────────────


class WetPalayParams(BaseModel):
    moisture_over: float = PydanticField(14, ge=10, le=35)
    hours: int = PydanticField(12, ge=1, le=96)
    email: bool = True


def _wet_palay(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, WetPalayParams)
    db = ctx.db
    drying = db.query(DryingRecord.id).filter(DryingRecord.purchase_item_id == PalayPurchaseItem.id).exists()
    rows = (
        db.query(PalayPurchaseItem, PalayPurchase)
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(
            PalayPurchase.status != "cancelled",
            PalayPurchaseItem.moisture_content_pct > params.moisture_over,
            PalayPurchase.created_at <= ctx.now - timedelta(hours=params.hours),
            PalayPurchase.created_at >= ctx.now - timedelta(days=7),
            ~drying,
        )
        .order_by(PalayPurchase.created_at)
        .all()
    )
    notices = []
    for item, purchase in rows:
        net = Decimal(item.gross_weight_kg) - Decimal(item.tare_weight_kg)
        variety = item.variety.name if item.variety else "palay"
        supplier = purchase.supplier.name if purchase.supplier else "an unnamed supplier"
        notices.append(
            Notice(
                title=f"Wet palay waiting to dry: {purchase.reference_no}",
                body=(
                    f"{kg(net)} of {variety} at {item.moisture_content_pct:.0f}% moisture from {supplier}, "
                    f"bought {_hours_ago(ctx, purchase.created_at)} ago, has no drying record. "
                    "Wet palay starts to spoil within a day or two."
                ),
                link="/paddy",
                dedupe_key=f"wet_palay:{item.id}",
            )
        )
    return notices


WET_PALAY = Recipe(
    code="wet_palay",
    title="Wet palay not drying",
    description="Wet palay bought hours ago that nobody has started drying.",
    group="production",
    section="paddy",
    default_roles=("owner", "mill_operator"),
    params=WetPalayParams,
    fields=(
        Field("moisture_over", "Palay wetter than", "percent", "14% is safe for storage."),
        Field("hours", "Waiting longer than", "number", unit="hours"),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_wet_palay,
)


# ── left open too long ───────────────────────────────────────────────────────


class LeftOpenParams(BaseModel):
    batch_hours: int = PydanticField(12, ge=1, le=96)
    drying_hours: int = PydanticField(48, ge=6, le=240)
    email: bool = True


def _left_open(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    assert isinstance(params, LeftOpenParams)
    db = ctx.db
    notices = []
    batches = (
        db.query(MillingBatch)
        .filter(
            MillingBatch.status == "in_progress",
            MillingBatch.start_datetime <= ctx.now - timedelta(hours=params.batch_hours),
            MillingBatch.start_datetime >= ctx.now - STALE_AFTER,
        )
        .order_by(MillingBatch.start_datetime)
        .all()
    )
    for b in batches:
        notices.append(
            Notice(
                title=f"Milling batch still open: {b.batch_no}",
                body=(
                    f"Started {local_time(b.start_datetime, ctx.zone)}, {_hours_ago(ctx, b.start_datetime)} ago. "
                    "Until it's completed, its rice isn't in your stock."
                ),
                link="/milling",
                dedupe_key=f"left_open:batch:{b.id}",
            )
        )
    rows = (
        db.query(DryingRecord, PalayPurchase.reference_no)
        .outerjoin(PalayPurchaseItem, PalayPurchaseItem.id == DryingRecord.purchase_item_id)
        .outerjoin(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(
            DryingRecord.end_datetime.is_(None),
            DryingRecord.start_datetime <= ctx.now - timedelta(hours=params.drying_hours),
            DryingRecord.start_datetime >= ctx.now - STALE_AFTER,
        )
        .order_by(DryingRecord.start_datetime)
        .all()
    )
    for record, reference in rows:
        what = f" for {reference}" if reference else ""
        notices.append(
            Notice(
                title=f"Drying not finished{what}",
                body=(
                    f"Started {local_time(record.start_datetime, ctx.zone)}, "
                    f"{_hours_ago(ctx, record.start_datetime)} ago. Record the final moisture when it's done."
                ),
                link="/paddy",
                dedupe_key=f"left_open:drying:{record.id}",
            )
        )
    return notices


LEFT_OPEN = Recipe(
    code="left_open",
    title="Left open too long",
    description="A milling batch or a drying run that was started but never finished in the app.",
    group="production",
    section="milling",
    default_roles=("owner", "mill_operator"),
    params=LeftOpenParams,
    fields=(
        Field("batch_hours", "Milling batches open longer than", "number", unit="hours"),
        Field("drying_hours", "Drying runs open longer than", "number", unit="hours"),
        EMAIL_FIELD,
    ),
    schedule=_every_tick,
    build=_left_open,
)


PRODUCTION_RECIPES = (MILLING_QUALITY, WET_PALAY, LEFT_OPEN)
