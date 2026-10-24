"""Repositories for the dispatch domain (Phase 3)."""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from ..core.branch_scope import only_viewed
from ..models.dispatch import Agent, Miller
from ..models.sales import SalesOrder
from .base import BaseRepository


class AgentRepository(BaseRepository[Agent]):
    model = Agent

    def list_for_company(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[Agent]:
        stmt = select(Agent).where(Agent.company_id == company_id)
        if not include_inactive:
            stmt = stmt.where(Agent.is_active.is_(True))
        return self.db.execute(stmt.order_by(Agent.name)).scalars().all()


class MillerRepository(BaseRepository[Miller]):
    model = Miller

    def list_for_company(self, company_id: uuid.UUID, *, include_inactive: bool = False) -> Sequence[Miller]:
        stmt = select(Miller).where(Miller.company_id == company_id)
        if not include_inactive:
            stmt = stmt.where(Miller.is_active.is_(True))
        return self.db.execute(stmt.order_by(Miller.name)).scalars().all()


class DispatchOrderRepository(BaseRepository[SalesOrder]):
    model = SalesOrder

    _COURIER_JOINS = (
        joinedload(SalesOrder.customer),
        joinedload(SalesOrder.assigned_agent),
        joinedload(SalesOrder.assigned_miller),
    )

    def list_for_dispatch(self, company_id: uuid.UUID, *, status: str | None = None) -> Sequence[SalesOrder]:
        stmt = only_viewed(
            select(SalesOrder).where(SalesOrder.company_id == company_id), SalesOrder.branch_id, self.db
        ).options(*self._COURIER_JOINS)
        if status:
            stmt = stmt.where(SalesOrder.status == status)
        else:
            stmt = stmt.where(SalesOrder.status.in_(["confirmed", "delivered"]))
        return self.db.execute(stmt.order_by(SalesOrder.order_date.desc())).unique().scalars().all()

    def get_with_couriers(self, order_id: uuid.UUID) -> SalesOrder:
        stmt = select(SalesOrder).options(*self._COURIER_JOINS).where(SalesOrder.id == order_id)
        return self.db.execute(stmt).unique().scalar_one()
