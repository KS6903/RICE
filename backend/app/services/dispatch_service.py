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

from ..core.exceptions import BadRequestError, ConflictError, NotFoundError
from ..models.dispatch import Agent, Miller
from ..models.sales import SalesOrder
from ..repositories.dispatch import AgentRepository, DispatchOrderRepository, MillerRepository
from ..services.base import BaseService
from ..services.canva_color import PALETTE, colors_in_use, pick_unused_color
from ..services.delivery_rules import check_can_unmark, edit_deadline, has_courier


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
            "deactivated_at": a.deactivated_at.isoformat() if a.deactivated_at else None,
            "deactivated_by": a.deactivated_by.full_name if a.deactivated_by else None,
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
            "deactivated_at": m.deactivated_at.isoformat() if m.deactivated_at else None,
            "deactivated_by": m.deactivated_by.full_name if m.deactivated_by else None,
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
            # Until when the owner can still take the delivered mark off (null when
            # the order isn't delivered).
            "unmark_until": deadline.isoformat() if (deadline := edit_deadline(o)) else None,
            "customer": {"id": str(o.customer.id), "name": o.customer.name} if o.customer else None,
            "courier_type": o.courier_type or ("mill" if (o.assigned_agent or o.assigned_miller) else None),
            "courier_plate": o.courier_plate,
            "courier_driver": o.courier_driver,
            "courier_phone": o.courier_phone,
            "courier_notes": o.courier_notes,
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
        updates = data.model_dump(exclude_none=True)
        with self.transaction():
            for f, v in updates.items():
                setattr(a, f, v)
            # The type is optional, so an explicit null clears it (exclude_none
            # above would otherwise leave the old value in place).
            if "agent_type" in data.model_fields_set and data.agent_type is None:
                a.agent_type = None
            if "is_active" in updates:
                if updates["is_active"]:
                    a.deactivated_at = None
                    a.deactivated_by_id = None
                else:
                    a.deactivated_at = datetime.now(timezone.utc)
                    a.deactivated_by_id = self.current_user.id
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
        updates = data.model_dump(exclude_none=True)
        with self.transaction():
            for f, v in updates.items():
                setattr(m, f, v)
            if "is_active" in updates:
                if updates["is_active"]:
                    m.deactivated_at = None
                    m.deactivated_by_id = None
                else:
                    m.deactivated_at = datetime.now(timezone.utc)
                    m.deactivated_by_id = self.current_user.id
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
        """Say who delivers the order: the customer, or the rice mill's courier
        (None clears it), with the plate number and the driver. The driver's
        phone and the notes are optional."""
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        if data.courier_type is None and order.status == "delivered":
            # A delivered order always says who delivered it.
            raise ConflictError("A delivered order keeps its courier. Choose a different one instead.")
        plate = " ".join((data.plate_number or "").split()).upper() or None
        driver = " ".join((data.driver_name or "").split()) or None
        if data.courier_type and not (plate and driver):
            raise BadRequestError("Enter the plate number and the driver's name.")
        phone = (data.driver_phone or "").strip() or None
        notes = (data.notes or "").strip() or None
        on = data.courier_type is not None
        with self.transaction():
            order.courier_type = data.courier_type
            order.courier_plate = plate if on else None
            order.courier_driver = driver if on else None
            order.courier_phone = phone if on else None
            order.courier_notes = notes if on else None
            # Anyone assigned the old way is replaced by this choice.
            order.assigned_agent_id = None
            order.assigned_miller_id = None
        return self._serialize_order(self.orders.get_with_couriers(order_id))

    def mark_delivered(self, order_id: uuid.UUID) -> dict:
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        if not has_courier(order):
            raise ConflictError(
                "Choose who delivers it (the customer or the rice mill courier) before marking it delivered."
            )
        with self.transaction():
            order.status = "delivered"
            order.delivered_at = datetime.now(timezone.utc)
        return self._serialize_order(self.orders.get_with_couriers(order_id))

    def unmark_delivered(self, order_id: uuid.UUID) -> dict:
        """The owner takes a delivered mark back, within a week of it being made."""
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        check_can_unmark(order, self.current_user)
        with self.transaction():
            order.status = "confirmed"
            order.delivered_at = None
        return self._serialize_order(self.orders.get_with_couriers(order_id))
