"""Pallets that follow the stock: milling puts them on the floor with their real
milling date, and sales take from them oldest first.

A mill with no warehouse layout has no pallets, and all of this does nothing. A sale
takes from pallets on its own, so FIFO holds without anyone choosing. The one way
round it is marking a pallet to go first, which needs a reason when older ones are
waiting, and that reason is logged. Pallets on hold are never taken.

None of these commit: they run inside the caller's transaction.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.exceptions import ConflictError, ValidationError
from ..core.timezones import tenant_zone
from ..models.company import Company
from ..models.milling import MillingBatch
from ..models.warehouse import Pallet, PalletMovement, RiceBatch, StockHold, WarehouseLayout, WarehouseZone
from .canva_bootstrap import KG_PER_PALLET, KG_PER_SACK, _next_pallet_code
from .rice_shelf_life import aging_status, compute_best_before
from .savings_formulas import settings_for

SOLD = "sold"
RETURNED = "returned"
PICK_FIRST = "pick_first"
PALLET_W_M, PALLET_D_M, SPACING_M = Decimal("1.2"), Decimal("0.8"), Decimal("0.3")


def _sacks(weight: Decimal) -> int:
    return max(1, int(round(float(weight) / KG_PER_SACK))) if weight > Decimal("0.01") else 0


def _layout_of(db: Session, branch_id: Any) -> WarehouseLayout | None:
    return (
        db.query(WarehouseLayout)
        .filter(
            WarehouseLayout.branch_id == branch_id,
            WarehouseLayout.deleted_at.is_(None),
        )
        .order_by(WarehouseLayout.is_default.desc(), WarehouseLayout.created_at)
        .first()
    )


def _place(db: Session, layout: WarehouseLayout, batch: MillingBatch, variety_id: Any, kg: Decimal) -> None:
    zone = (
        db.query(WarehouseZone)
        .filter(WarehouseZone.layout_id == layout.id, WarehouseZone.zone_type == "premium_storage")
        .first()
    )
    if zone is None:
        return
    company = db.get(Company, batch.company_id)
    milled_on = batch.start_datetime.astimezone(tenant_zone(getattr(company, "timezone", None))).date()
    weights = [(Decimal(i.input_weight_kg), i.moisture_content_pct) for i in batch.inputs if i.moisture_content_pct]
    total = sum((w for w, _ in weights), Decimal(0))
    moisture = sum((w * m for w, m in weights), Decimal(0)) / total if total else None
    cols = max(1, int((zone.width_m - Decimal("0.5")) // (PALLET_W_M + SPACING_M)))
    slot = (
        db.query(func.count(Pallet.id)).filter(Pallet.zone_id == zone.id, Pallet.status != "dispatched").scalar() or 0
    )
    rows = max(1, int((zone.height_m - Decimal("0.75")) // (PALLET_D_M + SPACING_M)))
    left = kg
    while left > Decimal("0.01"):
        chunk = min(Decimal(str(KG_PER_PALLET)), left)
        left -= chunk
        col, row = slot % cols, (slot // cols) % rows  # a full zone stacks up visibly, never spills out of it
        pallet = Pallet(
            company_id=batch.company_id,
            layout_id=layout.id,
            zone_id=zone.id,
            pallet_code=_next_pallet_code(db, layout.company_id),
            x_m=zone.x_m + Decimal("0.25") + col * (PALLET_W_M + SPACING_M),
            y_m=zone.y_m + Decimal("0.5") + row * (PALLET_D_M + SPACING_M),
            z_layer=0,
            width_m=PALLET_W_M,
            depth_m=PALLET_D_M,
            sack_count=_sacks(chunk),
            weight_kg=chunk,
            status="in_storage",
        )
        db.add(pallet)
        db.flush()
        db.add(
            RiceBatch(
                company_id=batch.company_id,
                pallet_id=pallet.id,
                milling_batch_id=batch.id,
                variety_id=variety_id,
                client_type="mill_own",
                client_name="Mill stock",
                sack_count=pallet.sack_count,
                weight_kg=chunk,
                moisture_pct=moisture,
                milling_date=milled_on,
                best_before_date=compute_best_before(milled_on, moisture),
                status=aging_status(milled_on, moisture),
            )
        )
        limit = settings_for(company)["hold_moisture_over"]
        if limit is not None and moisture is not None and moisture > Decimal(str(limit)):
            pallet.status = "on_hold"
            db.add(
                StockHold(
                    company_id=batch.company_id,
                    branch_id=batch.branch_id,
                    pallet_id=pallet.id,
                    stock_type="milled_rice",
                    variety_id=variety_id,
                    weight_kg=chunk,
                    reason="moisture",
                    note=f"Milled at {moisture:.1f}% moisture, over the {limit}% limit",
                )
            )
        db.flush()
        slot += 1


def sync_batch(db: Session, batch: MillingBatch) -> None:
    """Bring a batch's pallets in line with its milled rice: new rice goes on the floor,
    and rice corrected away comes off, newest pallet first. What was sold stays sold."""
    layout = _layout_of(db, batch.branch_id)
    if layout is None:
        return
    db.flush()
    expected: dict[Any, Decimal] = {}
    if not batch.customer_id:
        for out in batch.outputs:
            if out.output_type == "milled_rice":
                expected[out.variety_id] = expected.get(out.variety_id, Decimal(0)) + Decimal(out.output_weight_kg)
    rows = db.query(RiceBatch).filter(RiceBatch.milling_batch_id == batch.id).all()
    for variety_id in {*expected, *(r.variety_id for r in rows)}:
        mine = [r for r in rows if r.variety_id == variety_id]
        pallets = [r.pallet_id for r in mine]
        sold = (
            db.query(func.sum(PalletMovement.weight_kg))
            .filter(PalletMovement.pallet_id.in_(pallets), PalletMovement.movement_type == SOLD)
            .scalar()
            if pallets
            else None
        )
        tracked = sum((Decimal(r.weight_kg) for r in mine), Decimal(0)) + Decimal(sold or 0)
        delta = expected.get(variety_id, Decimal(0)) - tracked
        if delta > Decimal("0.01"):
            _place(db, layout, batch, variety_id, delta)
        elif delta < Decimal("-0.01"):
            _remove(db, sorted(mine, key=lambda r: r.created_at, reverse=True), -delta)


def _remove(db: Session, rows: list[RiceBatch], kg: Decimal) -> None:
    left = kg
    for row in rows:
        if left <= 0:
            break
        take = min(Decimal(row.weight_kg), left)
        left -= take
        pallet = db.get(Pallet, row.pallet_id)
        if pallet is None:
            continue
        row.weight_kg = Decimal(row.weight_kg) - take
        pallet.weight_kg = Decimal(pallet.weight_kg) - take
        if pallet.weight_kg <= Decimal("0.01"):
            sold = db.query(PalletMovement.id).filter(
                PalletMovement.pallet_id == pallet.id, PalletMovement.movement_type == SOLD
            )
            if sold.first() is None and db.query(Pallet.id).filter(Pallet.stack_parent_id == pallet.id).first() is None:
                db.delete(pallet)  # never held anything real
                continue
            pallet.status = "dispatched"
        pallet.sack_count = _sacks(pallet.weight_kg)
        row.sack_count = _sacks(Decimal(row.weight_kg))


def _branch_layouts(db: Session, branch_id: Any) -> list[uuid.UUID]:
    return [
        lid
        for (lid,) in db.query(WarehouseLayout.id)
        .filter(WarehouseLayout.branch_id == branch_id, WarehouseLayout.deleted_at.is_(None))
        .all()
    ]


def consume_for_item(db: Session, user: Any, order: Any, item: Any) -> None:
    """A sale line takes its rice from the floor: any pallet marked to go first, then
    the oldest. Whatever's stacked on, or on hold, stays."""
    if item.item_type not in ("milled_rice", None) or item.variety_id is None:
        return
    layouts = _branch_layouts(db, order.branch_id)
    if not layouts:
        return
    covered = {p for (p,) in db.query(Pallet.stack_parent_id).filter(Pallet.stack_parent_id.isnot(None)).all()}
    rows = (
        db.query(Pallet, RiceBatch)
        .join(RiceBatch, RiceBatch.pallet_id == Pallet.id)
        .filter(
            Pallet.layout_id.in_(layouts),
            Pallet.status == "in_storage",
            RiceBatch.variety_id == item.variety_id,
            RiceBatch.weight_kg > 0,
        )
        .order_by(RiceBatch.milling_date, Pallet.created_at)
        .all()
    )
    rows.sort(key=lambda pb: pb[0].pick_first_reason is None)  # stable: oldest stays first within each
    left = Decimal(item.quantity_kg)
    for pallet, row in rows:
        if left <= 0:
            break
        if pallet.id in covered:
            continue
        take = min(Decimal(row.weight_kg), left)
        left -= take
        row.weight_kg = Decimal(row.weight_kg) - take
        row.sack_count = _sacks(Decimal(row.weight_kg))
        pallet.weight_kg = Decimal(pallet.weight_kg) - take
        pallet.sack_count = _sacks(Decimal(pallet.weight_kg))
        if pallet.weight_kg <= Decimal("0.01"):
            pallet.status = "dispatched"
            pallet.pick_first_reason = None
        db.add(
            PalletMovement(
                pallet_id=pallet.id,
                user_id=getattr(user, "id", None),
                movement_type=SOLD,
                from_zone_id=pallet.zone_id,
                weight_kg=take,
                order_id=order.id,
                notes=str(row.id),
            )
        )
    db.flush()


def restore_for_order(db: Session, user: Any, order: Any) -> None:
    """Put back what an order took from the floor."""
    moves = (
        db.query(PalletMovement).filter(PalletMovement.order_id == order.id, PalletMovement.movement_type == SOLD).all()
    )
    for move in moves:
        pallet = db.get(Pallet, move.pallet_id)
        weight = Decimal(move.weight_kg or 0)
        move.movement_type = RETURNED
        if pallet is None:
            continue
        pallet.weight_kg = Decimal(pallet.weight_kg) + weight
        pallet.sack_count = _sacks(Decimal(pallet.weight_kg))
        if pallet.status == "dispatched":
            pallet.status = "in_storage"
        row = db.get(RiceBatch, uuid.UUID(move.notes)) if move.notes else None
        if row is not None:
            row.weight_kg = Decimal(row.weight_kg) + weight
            row.sack_count = _sacks(Decimal(row.weight_kg))
    db.flush()


def older_waiting(db: Session, pallet: Pallet) -> list[str]:
    """The codes of older pallets of the same rice, still to go out."""
    mine = db.query(RiceBatch).filter(RiceBatch.pallet_id == pallet.id).all()
    if not mine:
        return []
    oldest = min(r.milling_date for r in mine)
    rows = (
        db.query(Pallet.pallet_code)
        .join(RiceBatch, RiceBatch.pallet_id == Pallet.id)
        .filter(
            Pallet.layout_id == pallet.layout_id,
            Pallet.status == "in_storage",
            Pallet.id != pallet.id,
            RiceBatch.variety_id.in_([r.variety_id for r in mine]),
            RiceBatch.milling_date < oldest,
        )
        .distinct()
        .all()
    )
    return sorted(code for (code,) in rows)


def pick_first(db: Session, user: Any, pallet: Pallet, reason: str | None) -> None:
    """Mark a pallet to go out next. Passing over older rice needs a reason."""
    if pallet.status != "in_storage":
        raise ValidationError("Only a pallet in storage can go out.")
    older = older_waiting(db, pallet)
    why = (reason or "").strip()
    if older and not why:
        raise ConflictError(
            f"Older pallets of this rice should go first: {', '.join(older[:5])}. Give a reason to send this one ahead.",
            code="fifo_older_waiting",
        )
    pallet.pick_first_reason = why or "Oldest of its rice"
    db.add(
        PalletMovement(
            pallet_id=pallet.id,
            user_id=getattr(user, "id", None),
            movement_type=PICK_FIRST,
            from_zone_id=pallet.zone_id,
            notes=why or None,
        )
    )
