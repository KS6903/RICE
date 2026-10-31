"""Which purchases a milling batch's palay came from.

Palay stock is pooled by variety and grade, so a batch can't know for certain. It is
assigned first in, first out: the oldest purchase lines of that palay with kilos not
yet milled. What no line covers is older stock, kept as a lot with no line.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.milling import MillingBatch, MillingBatchInput, MillingInputLot
from ..models.paddy import PalayPurchase, PalayPurchaseItem
from ..models.supplier_customer import Supplier


def allocate(
    db: Session,
    company_id: Any,
    branch_id: Any,
    row: MillingBatchInput,
    *,
    chosen: Any = None,
    on_or_before: Any = None,
) -> None:
    """Give a saved batch input its lots: the line the operator chose first, when they
    did, then the oldest. Doesn't commit."""
    q = (
        db.query(PalayPurchaseItem)
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .filter(
            PalayPurchase.company_id == company_id,
            PalayPurchase.branch_id == branch_id,
            PalayPurchase.status != "cancelled",
        )
    )
    if row.variety_id is not None:
        q = q.filter(PalayPurchaseItem.variety_id == row.variety_id)
    if row.grade_id is not None:
        q = q.filter(PalayPurchaseItem.grade_id == row.grade_id)
    if on_or_before is not None:
        q = q.filter(PalayPurchase.purchase_date <= on_or_before)
    lines = q.order_by(PalayPurchase.purchase_date, PalayPurchase.created_at, PalayPurchaseItem.id).all()
    lines.sort(key=lambda line: line.id != chosen)  # stable: oldest stays first after it
    used = dict(
        db.query(MillingInputLot.purchase_item_id, func.sum(MillingInputLot.weight_kg))
        .filter(MillingInputLot.purchase_item_id.in_([i.id for i in lines]))
        .group_by(MillingInputLot.purchase_item_id)
        .all()
    )
    remaining = Decimal(row.input_weight_kg)
    for line in lines:
        if remaining <= 0:
            break
        if line.is_drying:  # still on the dryer: not what went into the mill
            continue
        free = Decimal(line.stock_weight_kg) - Decimal(used.get(line.id) or 0)
        take = min(free, remaining)
        if take <= 0:
            continue
        db.add(MillingInputLot(input_id=row.id, purchase_item_id=line.id, weight_kg=take))
        remaining -= take
    if remaining > 0:
        db.add(MillingInputLot(input_id=row.id, purchase_item_id=None, weight_kg=remaining))


def available(db: Session, company_id: Any, branch_id: Any, variety_id: Any) -> list[dict]:
    """Purchase lines of a palay with kilos not yet milled, oldest first, to choose from."""
    q = (
        db.query(PalayPurchaseItem, PalayPurchase, Supplier.name)
        .join(PalayPurchase, PalayPurchase.id == PalayPurchaseItem.purchase_id)
        .outerjoin(Supplier, Supplier.id == PalayPurchase.supplier_id)
        .filter(
            PalayPurchase.company_id == company_id,
            PalayPurchase.branch_id == branch_id,
            PalayPurchase.status != "cancelled",
        )
    )
    if variety_id is not None:
        q = q.filter(PalayPurchaseItem.variety_id == variety_id)
    rows = q.order_by(PalayPurchase.purchase_date, PalayPurchase.created_at).all()
    used = dict(
        db.query(MillingInputLot.purchase_item_id, func.sum(MillingInputLot.weight_kg))
        .filter(MillingInputLot.purchase_item_id.in_([line.id for line, _, _ in rows]))
        .group_by(MillingInputLot.purchase_item_id)
        .all()
    )
    out = []
    for line, purchase, supplier in rows:
        free = Decimal(line.stock_weight_kg) - Decimal(used.get(line.id) or 0)
        if free > 0 and not line.is_drying:
            out.append(
                {
                    "id": str(line.id),
                    "reference_no": purchase.reference_no,
                    "purchase_date": purchase.purchase_date,
                    "supplier": supplier,
                    "free_kg": float(free),
                }
            )
    return out


def backfill(db: Session, company_id: Any) -> int:
    """Give older batches of the mill's own palay their lots, in the order they were
    milled, from what had been bought by then. Safe to repeat: an input with lots is
    left alone. Doesn't commit."""
    rows = (
        db.query(MillingBatchInput, MillingBatch)
        .join(MillingBatch, MillingBatch.id == MillingBatchInput.batch_id)
        .outerjoin(MillingInputLot, MillingInputLot.input_id == MillingBatchInput.id)
        .filter(
            MillingBatch.company_id == company_id,
            MillingBatch.customer_id.is_(None),
            MillingBatch.status != "cancelled",
            MillingInputLot.id.is_(None),
        )
        .order_by(MillingBatch.start_datetime)
        .all()
    )
    for row, batch in rows:
        allocate(db, company_id, batch.branch_id, row, on_or_before=batch.start_datetime.date())
        db.flush()
    return len(rows)
