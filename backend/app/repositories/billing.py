"""Repositories for tenant billing (Phase 3)."""
from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.subscription import Subscription, SubscriptionPlan
from ..models.upgrade_request import UpgradeRequest
from .base import BaseRepository


class SubscriptionPlanRepository(BaseRepository[SubscriptionPlan]):
    model = SubscriptionPlan

    def list_active(self) -> Sequence[SubscriptionPlan]:
        stmt = (
            select(SubscriptionPlan)
            .where(SubscriptionPlan.is_active.is_(True))
            .order_by(SubscriptionPlan.sort_order)
        )
        return self.db.execute(stmt).scalars().all()


class SubscriptionRepository(BaseRepository[Subscription]):
    model = Subscription

    def get_by_company(self, company_id: uuid.UUID) -> Subscription | None:
        """One subscription per company — looked up by company, not row id."""
        stmt = select(Subscription).where(Subscription.company_id == company_id)
        return self.db.execute(stmt).scalars().first()


class UpgradeRequestRepository(BaseRepository[UpgradeRequest]):
    model = UpgradeRequest

    def pending_for_company(self, company_id: uuid.UUID) -> UpgradeRequest | None:
        stmt = select(UpgradeRequest).where(
            UpgradeRequest.company_id == company_id, UpgradeRequest.status == "pending"
        )
        return self.db.execute(stmt).scalars().first()

    def latest_for_company(self, company_id: uuid.UUID) -> UpgradeRequest | None:
        """Prefer the pending request; otherwise the most recent of any status."""
        pending = (
            select(UpgradeRequest)
            .where(UpgradeRequest.company_id == company_id, UpgradeRequest.status == "pending")
            .order_by(UpgradeRequest.created_at.desc())
        )
        r = self.db.execute(pending).scalars().first()
        if r:
            return r
        any_stmt = (
            select(UpgradeRequest)
            .where(UpgradeRequest.company_id == company_id)
            .order_by(UpgradeRequest.created_at.desc())
        )
        return self.db.execute(any_stmt).scalars().first()
