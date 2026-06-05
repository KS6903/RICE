"""DispatchService — agents, millers, and courier assignment (Phase 3).

Canva color is system-assigned from the shared per-tenant pool (canva_color
service); delete is a soft-delete that releases the color back to the pool.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, NotFoundError
from ..models.dispatch import Agent, Miller
from ..models.sales import SalesOrder
from ..repositories.dispatch import AgentRepository, DispatchOrderRepository, MillerRepository
from ..services.base import BaseService
from ..services.canva_color import PALETTE, colors_in_use, pick_unused_color


class DispatchService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        agents: AgentRepository,
        millers: MillerRepository,
        orders: DispatchOrderRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.agents = agents
        self.millers = millers
        self.orders = orders

    # ── serializers ───────────────────────────────────────────────────────────

    @staticmethod
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

    @staticmethod
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

    def _serialize_order(self, o: SalesOrder) -> dict:
        return {
            "id": str(o.id),
            "order_no": o.order_no,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None,
            "status": o.status,
            "total_amount": float(o.total_amount) if o.total_amount is not None else None,
            "delivered_at": o.delivered_at.isoformat() if o.delivered_at else None,
            "customer": {"id": str(o.customer.id), "name": o.customer.name} if o.customer else None,
            "assigned_agent": self._serialize_agent(o.assigned_agent) if o.assigned_agent else None,
            "assigned_miller": self._serialize_miller(o.assigned_miller) if o.assigned_miller else None,
        }

    # ── agents ────────────────────────────────────────────────────────────────

    def list_agents(self, *, include_inactive: bool = False) -> list[dict]:
        rows = self.agents.list_for_company(self.current_user.company_id, include_inactive=include_inactive)
        return [self._serialize_agent(a) for a in rows]

    def create_agent(self, data) -> dict:
        color = pick_unused_color(self.db, self.current_user.company_id)
        agent = Agent(
            company_id=self.current_user.company_id,
            branch_id=getattr(self.current_user, "branch_id", None),
            name=data.name.strip(),
            agent_type=data.agent_type,
            contact_person=data.contact_person,
            phone=data.phone,
            address=data.address,
            commission_pct=data.commission_pct or Decimal("0"),
            canva_color_hex=color,
            is_active=True,
        )
        with self.transaction():
            self.agents.add(agent)
        self.db.refresh(agent)
        return self._serialize_agent(agent)

    def update_agent(self, agent_id: uuid.UUID, data) -> dict:
        a = self.agents.get_for_company(agent_id, self.current_user.company_id)
        if not a:
            raise NotFoundError("Agent not found")
        with self.transaction():
            for f, v in data.model_dump(exclude_none=True).items():
                setattr(a, f, v)
        self.db.refresh(a)
        return self._serialize_agent(a)

    def delete_agent(self, agent_id: uuid.UUID) -> dict:
        a = self.agents.get_for_company(agent_id, self.current_user.company_id)
        if not a:
            raise NotFoundError("Agent not found")
        with self.transaction():
            a.is_active = False
            a.canva_color_hex = None  # release the color back to the pool
        return {"ok": True}

    # ── millers ───────────────────────────────────────────────────────────────

    def list_millers(self, *, include_inactive: bool = False) -> list[dict]:
        rows = self.millers.list_for_company(self.current_user.company_id, include_inactive=include_inactive)
        return [self._serialize_miller(m) for m in rows]

    def create_miller(self, data) -> dict:
        color = pick_unused_color(self.db, self.current_user.company_id)
        miller = Miller(
            company_id=self.current_user.company_id,
            branch_id=getattr(self.current_user, "branch_id", None),
            name=data.name.strip(),
            contact_person=data.contact_person,
            phone=data.phone,
            address=data.address,
            capacity_kg_per_hr=data.capacity_kg_per_hr,
            milling_fee_per_kg=data.milling_fee_per_kg,
            canva_color_hex=color,
            is_active=True,
        )
        with self.transaction():
            self.millers.add(miller)
        self.db.refresh(miller)
        return self._serialize_miller(miller)

    def update_miller(self, miller_id: uuid.UUID, data) -> dict:
        m = self.millers.get_for_company(miller_id, self.current_user.company_id)
        if not m:
            raise NotFoundError("Miller not found")
        with self.transaction():
            for f, v in data.model_dump(exclude_none=True).items():
                setattr(m, f, v)
        self.db.refresh(m)
        return self._serialize_miller(m)

    def delete_miller(self, miller_id: uuid.UUID) -> dict:
        m = self.millers.get_for_company(miller_id, self.current_user.company_id)
        if not m:
            raise NotFoundError("Miller not found")
        with self.transaction():
            m.is_active = False
            m.canva_color_hex = None
        return {"ok": True}

    # ── palette + dispatch orders ─────────────────────────────────────────────

    def get_palette(self) -> dict:
        used = colors_in_use(self.db, self.current_user.company_id)
        return {"palette": list(PALETTE), "in_use": sorted(used)}

    def list_dispatch_orders(self, status_filter: str | None = None) -> list[dict]:
        rows = self.orders.list_for_dispatch(self.current_user.company_id, status=status_filter)
        return [self._serialize_order(o) for o in rows]

    def assign_courier(self, order_id: uuid.UUID, data) -> dict:
        if data.agent_id and data.miller_id:
            raise BadRequestError("Assign either an agent or a miller, not both.")
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        with self.transaction():
            if data.agent_id:
                agent = self.agents.get_for_company(data.agent_id, self.current_user.company_id)
                if not agent:
                    raise NotFoundError("Agent not found")
                order.assigned_agent_id = data.agent_id
                order.assigned_miller_id = None
            elif data.miller_id:
                miller = self.millers.get_for_company(data.miller_id, self.current_user.company_id)
                if not miller:
                    raise NotFoundError("Miller not found")
                order.assigned_miller_id = data.miller_id
                order.assigned_agent_id = None
            else:
                order.assigned_agent_id = None
                order.assigned_miller_id = None
        return self._serialize_order(self.orders.get_with_couriers(order_id))

    def mark_delivered(self, order_id: uuid.UUID) -> dict:
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        with self.transaction():
            order.status = "delivered"
            order.delivered_at = datetime.now(timezone.utc)
        return self._serialize_order(self.orders.get_with_couriers(order_id))
