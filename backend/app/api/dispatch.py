"""Dispatch HTTP controllers — thin routing over DispatchService (Phase 3).

Gated by the `sales` feature. Agents, millers, palette, dispatch order list, and
courier assignment / delivery marking.
"""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..repositories.dispatch import AgentRepository, DispatchOrderRepository, MillerRepository
from ..schemas.dispatch import (
    AgentCreate,
    AgentUpdate,
    CourierAssign,
    MillerCreate,
    MillerUpdate,
)
from ..services.dispatch_service import DispatchService

router = APIRouter(dependencies=[Depends(require_feature("sales"))])

WRITE_ROLES = ("owner", "admin")


def get_dispatch_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> DispatchService:
    return DispatchService(
        db,
        current_user,
        agents=AgentRepository(db),
        millers=MillerRepository(db),
        orders=DispatchOrderRepository(db),
    )


# ── Agents ──────────────────────────────────────────────────────────────────

@router.get("/agents")
def list_agents(include_inactive: bool = False, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.list_agents(include_inactive=include_inactive)


@router.post("/agents", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(*WRITE_ROLES))])
def create_agent(body: AgentCreate, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.create_agent(body)


@router.put("/agents/{agent_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def update_agent(agent_id: uuid.UUID, body: AgentUpdate, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.update_agent(agent_id, body)


@router.delete("/agents/{agent_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def delete_agent(agent_id: uuid.UUID, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.delete_agent(agent_id)


# ── Millers ─────────────────────────────────────────────────────────────────

@router.get("/millers")
def list_millers(include_inactive: bool = False, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.list_millers(include_inactive=include_inactive)


@router.post("/millers", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(*WRITE_ROLES))])
def create_miller(body: MillerCreate, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.create_miller(body)


@router.put("/millers/{miller_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def update_miller(miller_id: uuid.UUID, body: MillerUpdate, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.update_miller(miller_id, body)


@router.delete("/millers/{miller_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def delete_miller(miller_id: uuid.UUID, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.delete_miller(miller_id)


# ── Palette + dispatch orders ────────────────────────────────────────────────

@router.get("/dispatch/palette")
def get_palette(svc: DispatchService = Depends(get_dispatch_service)):
    return svc.get_palette()


@router.get("/dispatch/orders")
def list_dispatch_orders(status_filter: str | None = None, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.list_dispatch_orders(status_filter)


@router.patch("/sales-orders/{order_id}/assign-courier", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def assign_courier(order_id: uuid.UUID, body: CourierAssign, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.assign_courier(order_id, body)


@router.patch("/sales-orders/{order_id}/mark-delivered", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def mark_delivered(order_id: uuid.UUID, svc: DispatchService = Depends(get_dispatch_service)):
    return svc.mark_delivered(order_id)
