"""Dispatch API — agents, millers, and courier assignment on sales orders.

Gated by the `sales` feature (same plan-gate as the Sales module). Color
assignment is centralised in `services/canva_color.py` so all four party
tables (Customer / Supplier / Agent / Miller) share one tenant-wide pool.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..models.dispatch import Agent, Miller
from ..models.sales import SalesOrder
from ..services.canva_color import PALETTE, pick_unused_color

router = APIRouter(dependencies=[Depends(require_feature("sales"))])

WRITE_ROLES = ("owner", "admin")


# ── Serializers ──────────────────────────────────────────────────────────────


def _serialize_agent(a: Agent) -> dict:
    return {
        "id": str(a.id),
        "name": a.name,
        "agent_type": a.agent_type,
        "contact_person": a.contact_person,
        "phone": a.phone,
        "address": a.address,
        "commission_pct": float(a.commission_pct) if a.commission_pct is not None else 0.0,
        "is_active": a.is_active,
        "canva_color_hex": a.canva_color_hex,
    }


def _serialize_miller(m: Miller) -> dict:
    return {
        "id": str(m.id),
        "name": m.name,
        "contact_person": m.contact_person,
        "phone": m.phone,
        "address": m.address,
        "capacity_kg_per_hr": float(m.capacity_kg_per_hr) if m.capacity_kg_per_hr is not None else None,
        "milling_fee_per_kg": float(m.milling_fee_per_kg) if m.milling_fee_per_kg is not None else None,
        "is_active": m.is_active,
        "canva_color_hex": m.canva_color_hex,
    }


def _serialize_order(o: SalesOrder) -> dict:
    return {
        "id": str(o.id),
        "order_no": o.order_no,
        "order_date": o.order_date.isoformat() if o.order_date else None,
        "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None,
        "status": o.status,
        "total_amount": float(o.total_amount) if o.total_amount is not None else None,
        "delivered_at": o.delivered_at.isoformat() if o.delivered_at else None,
        "customer": (
            {"id": str(o.customer.id), "name": o.customer.name} if o.customer else None
        ),
        "assigned_agent": (
            _serialize_agent(o.assigned_agent) if o.assigned_agent else None
        ),
        "assigned_miller": (
            _serialize_miller(o.assigned_miller) if o.assigned_miller else None
        ),
    }


# ── Agents CRUD ──────────────────────────────────────────────────────────────


# Canva color is system-generated and never user-editable — the create/update
# schemas deliberately OMIT `canva_color_hex` so any client-supplied value is
# silently dropped by Pydantic.
class AgentCreate(BaseModel):
    name: str
    agent_type: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    commission_pct: Decimal = Decimal("0")


class AgentUpdate(BaseModel):
    name: str | None = None
    agent_type: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    commission_pct: Decimal | None = None
    is_active: bool | None = None


@router.get("/agents")
def list_agents(
    include_inactive: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Agent).filter(Agent.company_id == current_user.company_id)
    if not include_inactive:
        q = q.filter(Agent.is_active == True)  # noqa: E712
    return [_serialize_agent(a) for a in q.order_by(Agent.name).all()]


@router.post("/agents", status_code=status.HTTP_201_CREATED)
def create_agent(
    body: AgentCreate,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    # Color is auto-generated server-side from the shared tenant pool — clients
    # cannot pick or override it.
    color = pick_unused_color(db, current_user.company_id)
    agent = Agent(
        company_id=current_user.company_id,
        branch_id=getattr(current_user, "branch_id", None),
        name=body.name.strip(),
        agent_type=body.agent_type,
        contact_person=body.contact_person,
        phone=body.phone,
        address=body.address,
        commission_pct=body.commission_pct or Decimal("0"),
        canva_color_hex=color,
        is_active=True,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _serialize_agent(agent)


@router.put("/agents/{agent_id}")
def update_agent(
    agent_id: uuid.UUID,
    body: AgentUpdate,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    a = db.get(Agent, agent_id)
    if not a or a.company_id != current_user.company_id:
        raise HTTPException(404, "Agent not found")
    # `AgentUpdate` doesn't include `canva_color_hex` — color is system-managed.
    for f, v in body.model_dump(exclude_none=True).items():
        setattr(a, f, v)
    db.commit()
    db.refresh(a)
    return _serialize_agent(a)


@router.delete("/agents/{agent_id}")
def delete_agent(
    agent_id: uuid.UUID,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Soft-delete — keeps color reservation released so the slot is reusable."""
    a = db.get(Agent, agent_id)
    if not a or a.company_id != current_user.company_id:
        raise HTTPException(404, "Agent not found")
    a.is_active = False
    a.canva_color_hex = None  # release the color back to the pool
    db.commit()
    return {"ok": True}


# ── Millers CRUD ─────────────────────────────────────────────────────────────


class MillerCreate(BaseModel):
    name: str
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    capacity_kg_per_hr: Decimal | None = None
    milling_fee_per_kg: Decimal | None = None


class MillerUpdate(BaseModel):
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    capacity_kg_per_hr: Decimal | None = None
    milling_fee_per_kg: Decimal | None = None
    is_active: bool | None = None


@router.get("/millers")
def list_millers(
    include_inactive: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Miller).filter(Miller.company_id == current_user.company_id)
    if not include_inactive:
        q = q.filter(Miller.is_active == True)  # noqa: E712
    return [_serialize_miller(m) for m in q.order_by(Miller.name).all()]


@router.post("/millers", status_code=status.HTTP_201_CREATED)
def create_miller(
    body: MillerCreate,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    # Color is auto-generated server-side from the shared tenant pool.
    color = pick_unused_color(db, current_user.company_id)
    miller = Miller(
        company_id=current_user.company_id,
        branch_id=getattr(current_user, "branch_id", None),
        name=body.name.strip(),
        contact_person=body.contact_person,
        phone=body.phone,
        address=body.address,
        capacity_kg_per_hr=body.capacity_kg_per_hr,
        milling_fee_per_kg=body.milling_fee_per_kg,
        canva_color_hex=color,
        is_active=True,
    )
    db.add(miller)
    db.commit()
    db.refresh(miller)
    return _serialize_miller(miller)


@router.put("/millers/{miller_id}")
def update_miller(
    miller_id: uuid.UUID,
    body: MillerUpdate,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    m = db.get(Miller, miller_id)
    if not m or m.company_id != current_user.company_id:
        raise HTTPException(404, "Miller not found")
    # `MillerUpdate` doesn't include `canva_color_hex` — color is system-managed.
    for f, v in body.model_dump(exclude_none=True).items():
        setattr(m, f, v)
    db.commit()
    db.refresh(m)
    return _serialize_miller(m)


@router.delete("/millers/{miller_id}")
def delete_miller(
    miller_id: uuid.UUID,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    m = db.get(Miller, miller_id)
    if not m or m.company_id != current_user.company_id:
        raise HTTPException(404, "Miller not found")
    m.is_active = False
    m.canva_color_hex = None
    db.commit()
    return {"ok": True}


# ── Palette helper for the UI ────────────────────────────────────────────────


@router.get("/dispatch/palette")
def get_palette(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Full palette + which colors are already claimed in this tenant. The UI
    uses this to render a picker that visibly disables taken swatches."""
    from ..services.canva_color import colors_in_use
    used = colors_in_use(db, current_user.company_id)
    return {
        "palette": list(PALETTE),
        "in_use": sorted(used),
    }


# ── Dispatch (orders) ────────────────────────────────────────────────────────


@router.get("/dispatch/orders")
def list_dispatch_orders(
    status_filter: str | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List orders relevant to dispatch — defaults to confirmed + delivered,
    which is what the Order Delivery tab cares about. Pass ?status_filter=
    to override."""
    q = (
        db.query(SalesOrder)
        .filter(SalesOrder.company_id == current_user.company_id)
        .options(
            joinedload(SalesOrder.customer),
            joinedload(SalesOrder.assigned_agent),
            joinedload(SalesOrder.assigned_miller),
        )
    )
    if status_filter:
        q = q.filter(SalesOrder.status == status_filter)
    else:
        q = q.filter(SalesOrder.status.in_(["confirmed", "delivered"]))
    return [_serialize_order(o) for o in q.order_by(SalesOrder.order_date.desc()).all()]


class CourierAssign(BaseModel):
    agent_id: uuid.UUID | None = None
    miller_id: uuid.UUID | None = None


@router.patch("/sales-orders/{order_id}/assign-courier")
def assign_courier(
    order_id: uuid.UUID,
    body: CourierAssign,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    if body.agent_id and body.miller_id:
        raise HTTPException(400, "Assign either an agent or a miller, not both.")
    order = db.get(SalesOrder, order_id)
    if not order or order.company_id != current_user.company_id:
        raise HTTPException(404, "Order not found")

    if body.agent_id:
        agent = db.get(Agent, body.agent_id)
        if not agent or agent.company_id != current_user.company_id:
            raise HTTPException(404, "Agent not found")
        order.assigned_agent_id = body.agent_id
        order.assigned_miller_id = None
    elif body.miller_id:
        miller = db.get(Miller, body.miller_id)
        if not miller or miller.company_id != current_user.company_id:
            raise HTTPException(404, "Miller not found")
        order.assigned_miller_id = body.miller_id
        order.assigned_agent_id = None
    else:
        # Both null — clear any existing courier.
        order.assigned_agent_id = None
        order.assigned_miller_id = None

    db.commit()
    db.refresh(order)
    # Re-query with joins so the response payload is complete.
    fresh = (
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.customer),
            joinedload(SalesOrder.assigned_agent),
            joinedload(SalesOrder.assigned_miller),
        )
        .filter(SalesOrder.id == order_id)
        .one()
    )
    return _serialize_order(fresh)


@router.patch("/sales-orders/{order_id}/mark-delivered")
def mark_delivered(
    order_id: uuid.UUID,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    order = db.get(SalesOrder, order_id)
    if not order or order.company_id != current_user.company_id:
        raise HTTPException(404, "Order not found")
    order.status = "delivered"
    order.delivered_at = datetime.now(timezone.utc)
    db.commit()
    fresh = (
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.customer),
            joinedload(SalesOrder.assigned_agent),
            joinedload(SalesOrder.assigned_miller),
        )
        .filter(SalesOrder.id == order_id)
        .one()
    )
    return _serialize_order(fresh)
