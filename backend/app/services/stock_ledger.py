"""The stock ledger: every change to a milled-rice or by-product balance, and sales
taking goods out of stock.

A sale takes its goods when the order is confirmed, from the branch's warehouses in
order, and the last one takes what's left: milled rice and by-products may go below
zero, which the negative_stock automation reports, because a sale is often recorded
before the stock it came from. Palay never goes below zero, as in milling. Cancelling
the order puts back exactly what it took. Orders from before this ledger have no
``stock_posted_at`` and never move stock, so old sales change nothing.

None of these commit: they run inside the caller's transaction.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.exceptions import ConflictError
from ..models.milling import ByproductInventory, MilledRiceInventory, StockMovement
from ..models.paddy import PalayInventory
from ..models.sales import SalesOrder, SalesOrderItem
from ..models.warehouse import StockHold
from . import pallet_flow
from .warehouses import default_warehouse_id, warehouse_ids_of

MODELS: dict[str, Any] = {"milled_rice": MilledRiceInventory, "byproduct": ByproductInventory, "palay": PalayInventory}


def stock_type_of(inv: Any) -> str:
    return next(kind for kind, model in MODELS.items() if isinstance(inv, model))


def record(
    db: Session,
    user: Any,
    inv: Any,
    delta: Decimal,
    source_type: str,
    source_id: uuid.UUID | None = None,
    notes: str | None = None,
) -> None:
    """Write down a change already made to a balance."""
    db.flush()
    db.add(
        StockMovement(
            company_id=inv.company_id,
            branch_id=inv.branch_id,
            warehouse_id=inv.warehouse_id,
            stock_type=stock_type_of(inv),
            inventory_id=inv.id,
            variety_id=getattr(inv, "variety_id", None),
            grade_name=getattr(inv, "grade_name", None),
            byproduct_type=getattr(inv, "byproduct_type", None),
            delta_kg=delta,
            balance_after_kg=inv.quantity_kg,
            source_type=source_type,
            source_id=source_id,
            notes=notes,
            created_by=getattr(user, "id", None),
        )
    )


def _matches(model: Any, item: SalesOrderItem, company_id: Any, branch_id: Any) -> list:
    """The filter for the balances a sale line can come from; empty when the line
    doesn't say what it sold."""
    where = [model.company_id == company_id, model.branch_id == branch_id]
    if model is ByproductInventory:
        return [*where, model.byproduct_type == item.byproduct_type] if item.byproduct_type else []
    if item.variety_id is None:
        return []
    where.append(model.variety_id == item.variety_id)
    if model is MilledRiceInventory and item.grade_name:
        where.append(model.grade_name == item.grade_name)
    return where


def _model_of(item: Any) -> Any:
    return {"byproduct": ByproductInventory, "palay": PalayInventory}.get(item.item_type, MilledRiceInventory)


def post_offline_item(db: Session, user: Any, company_id: Any, branch_id: Any, record_id: Any, payload: dict) -> bool:
    """A sale line entered on the desktop app while offline, now synced: it takes its
    goods as a sale here would. Safe to repeat: a line that already took them is left
    alone, since a push can be sent twice. Doesn't commit; True when stock moved."""
    note = f"Offline line {record_id}"
    if db.query(StockMovement.id).filter(StockMovement.notes == note).first() is not None:
        return False

    def as_id(value: Any) -> uuid.UUID | None:
        return uuid.UUID(str(value)) if value else None

    order_id = as_id(payload.get("order_id"))
    order: Any = _Offline(order_id, "", company_id, branch_id)
    item = _Line(
        str(payload.get("item_type") or "milled_rice"),
        as_id(payload.get("variety_id")),
        payload.get("grade_name"),
        payload.get("byproduct_type"),
    )
    item.quantity_kg = Decimal(str(payload["quantity_kg"]))
    _take(db, user, order, item, note=note)  # type: ignore[arg-type]
    pallet_flow.consume_for_item(db, user, order, item)
    return True


def unpost_offline_order(db: Session, user: Any, order_id: uuid.UUID) -> None:
    """An order cancelled on the desktop app: what its lines took goes back."""
    reverse_source(db, user, "sales_order", order_id, "Offline order cancelled")
    pallet_flow.restore_for_order(db, user, _Offline(order_id, "", None, None))


def _take(db: Session, user: Any, order: Any, item: Any, *, note: str | None = None) -> None:
    model = _model_of(item)
    where = _matches(model, item, order.company_id, order.branch_id)
    if not where:
        return
    rows = {inv.warehouse_id: inv for inv in db.query(model).filter(*where).all()}
    places = warehouse_ids_of(db, order.branch_id)
    held = [rows[w] for w in places if w in rows] + [inv for w, inv in rows.items() if w not in places]
    if not held:
        if model is PalayInventory:
            return
        first = default_warehouse_id(db, order.branch_id)
        extra = (
            {"byproduct_type": item.byproduct_type}
            if model is ByproductInventory
            else {"variety_id": item.variety_id, "grade_name": item.grade_name or "Straight Mill Rice"}
        )
        inv = model(
            company_id=order.company_id,
            branch_id=order.branch_id,
            warehouse_id=first,
            quantity_kg=Decimal("0"),
            **extra,
        )
        db.add(inv)
        held = [inv]
    remaining = Decimal(item.quantity_kg)
    for n, inv in enumerate(held):
        have = max(Decimal(inv.quantity_kg or 0), Decimal(0))
        take = min(have, remaining) if model is PalayInventory or n < len(held) - 1 else remaining
        if take <= 0:
            continue
        inv.quantity_kg = Decimal(inv.quantity_kg or 0) - take
        remaining -= take
        record(db, user, inv, -take, "sales_order", order.id, note or f"Order {order.order_no}")


def post_order(db: Session, user: Any, order: SalesOrder) -> None:
    """Take a confirmed order's goods out of stock, and off the warehouse floor."""
    db.flush()
    for item in order.items:
        _take(db, user, order, item)
        pallet_flow.consume_for_item(db, user, order, item)
    order.stock_posted_at = datetime.now(timezone.utc)


def reverse_source(db: Session, user: Any, source_type: str, source_id: uuid.UUID, notes: str) -> None:
    """Undo what a source still has out, balance by balance."""
    db.flush()
    rows = (
        db.query(StockMovement.stock_type, StockMovement.inventory_id, func.sum(StockMovement.delta_kg))
        .filter(StockMovement.source_type == source_type, StockMovement.source_id == source_id)
        .group_by(StockMovement.stock_type, StockMovement.inventory_id)
        .all()
    )
    for stock_type, inventory_id, net in rows:
        if not net:
            continue
        inv = db.get(MODELS[stock_type], inventory_id)
        if inv is None:
            continue
        inv.quantity_kg = Decimal(inv.quantity_kg or 0) - net
        record(db, user, inv, -net, source_type, source_id, notes)


def unpost_order(db: Session, user: Any, order: SalesOrder, *, keep_posted: bool = False) -> None:
    """Put back what an order took. Does nothing for an order that never took any."""
    if order.stock_posted_at is None:
        return
    reverse_source(db, user, "sales_order", order.id, f"Order {order.order_no} undone")
    pallet_flow.restore_for_order(db, user, order)
    if not keep_posted:
        order.stock_posted_at = None


def active_holds(db: Session, item: Any, company_id: Any, branch_id: Any) -> Decimal:
    """Kilos on hold of what a sale line sells, at the order's branch."""
    kind = {"byproduct": "byproduct", "palay": "palay"}.get(item.item_type, "milled_rice")
    q = db.query(func.sum(StockHold.weight_kg)).filter(
        StockHold.company_id == company_id,
        StockHold.branch_id == branch_id,
        StockHold.stock_type == kind,
        StockHold.cleared_at.is_(None),
    )
    if kind == "byproduct":
        q = q.filter(StockHold.byproduct_type == item.byproduct_type)
    else:
        q = q.filter(StockHold.variety_id == item.variety_id)
        if kind == "milled_rice" and item.grade_name:
            q = q.filter((StockHold.grade_name == item.grade_name) | StockHold.grade_name.is_(None))
    return Decimal(q.scalar() or 0)


def check_holds(db: Session, items: Any, company_id: Any, branch_id: Any) -> None:
    """Refuse a sale that can only be filled from stock on hold. A mill with nothing
    on hold is never asked about, so a sale recorded ahead of its stock still goes."""
    wanted: dict[tuple, Decimal] = {}
    for item in items:
        key = (item.item_type, item.variety_id, item.grade_name, item.byproduct_type)
        wanted[key] = wanted.get(key, Decimal(0)) + Decimal(item.quantity_kg)
    for key, qty in wanted.items():
        probe = _Line(*key)
        held = active_holds(db, probe, company_id, branch_id)
        if held <= 0:
            continue
        model = _model_of(probe)
        where = _matches(model, probe, company_id, branch_id)  # type: ignore[arg-type]
        on_hand = Decimal(db.query(func.sum(model.quantity_kg)).filter(*where).scalar() or 0) if where else Decimal(0)
        free = max(on_hand - held, Decimal(0))
        if qty > free:
            raise ConflictError(
                f"{held:,.0f} kg of this stock is on hold until it's cleared, so only {free:,.0f} kg can be sold. "
                "Clear the hold on the Savings page first.",
                code="stock_on_hold",
            )


class _Offline:
    """The parts of an order that say where its goods come from, for one that exists
    only on the desktop apps."""

    def __init__(self, order_id: Any, order_no: str, company_id: Any, branch_id: Any) -> None:
        self.id = order_id
        self.order_no = order_no
        self.company_id = company_id
        self.branch_id = branch_id


class _Line:
    """The parts of a sale line that say which stock it takes."""

    def __init__(self, item_type: str, variety_id: Any, grade_name: Any, byproduct_type: Any) -> None:
        self.item_type = item_type
        self.variety_id = variety_id
        self.grade_name = grade_name
        self.byproduct_type = byproduct_type
        self.quantity_kg = Decimal(0)
