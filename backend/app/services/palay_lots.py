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

from ..models.milling import MillingBatchInput, MillingInputLot
from ..models.paddy import PalayPurchase, PalayPurchaseItem


def allocate(db: Session, company_id: Any, branch_id: Any, row: MillingBatchInput) -> None:
    """Give a saved batch input its lots. Doesn't commit."""
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
    lines = q.order_by(PalayPurchase.purchase_date, PalayPurchase.created_at, PalayPurchaseItem.id).all()
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
