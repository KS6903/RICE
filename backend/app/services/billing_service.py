"""BillingService — tenant-facing billing (Phase 3). Plans, current subscription,
and the upgrade-request lifecycle. Uses the shared effective_status helper."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, ConflictError, NotFoundError
from ..models.subscription import SubscriptionPlan
from ..models.upgrade_request import UpgradeRequest
from ..repositories.billing import (
    SubscriptionPlanRepository,
    SubscriptionRepository,
    UpgradeRequestRepository,
)
from ..services import platform_emails
from ..services.base import BaseService
from ..services.subscription import effective_status


class BillingService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        plans: SubscriptionPlanRepository,
        subscriptions: SubscriptionRepository,
        requests: UpgradeRequestRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.plans = plans
        self.subscriptions = subscriptions
        self.requests = requests

    # ── serializers ───────────────────────────────────────────────────────────

    @staticmethod
    def _serialize_plan(p: SubscriptionPlan) -> dict:
        return {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "description": p.description,
            "monthly_price": float(p.monthly_price),
            "annual_price": float(p.annual_price),
            "max_users": p.max_users,
            "max_branches": p.max_branches,
            "features": list(p.features or []),
            "is_active": p.is_active,
            "sort_order": p.sort_order,
        }

    @staticmethod
    def _serialize_request(r: UpgradeRequest) -> dict:
        return {
            "id": str(r.id),
            "company_id": str(r.company_id),
            "requested_plan_id": str(r.requested_plan_id),
            "requested_plan_code": r.requested_plan.code if r.requested_plan else None,
            "requested_plan_name": r.requested_plan.name if r.requested_plan else None,
            "current_plan_id": str(r.current_plan_id) if r.current_plan_id else None,
            "current_plan_code": r.current_plan.code if r.current_plan else None,
            "current_plan_name": r.current_plan.name if r.current_plan else None,
            "requested_by": str(r.requested_by) if r.requested_by else None,
            "request_type": r.request_type,
            "billing_interval": r.billing_interval,
            "status": r.status,
            "note": r.note,
            "admin_note": r.admin_note,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        }

    # ── reads ─────────────────────────────────────────────────────────────────

    def list_plans(self) -> list[dict]:
        return [self._serialize_plan(p) for p in self.plans.list_active()]

    def my_subscription(self) -> dict:
        if not self.current_user.company_id:
            return {"subscription": None}
        sub = self.subscriptions.get_by_company(self.current_user.company_id)
        if not sub or not sub.plan:
            return {"subscription": None}
        return {
            "subscription": {
                "id": str(sub.id),
                "plan_id": str(sub.plan.id),
                "plan_code": sub.plan.code,
                "plan_name": sub.plan.name,
                "monthly_price": float(sub.plan.monthly_price),
                "features": list(sub.plan.features or []),
                "max_users": sub.plan.max_users,
                "max_branches": sub.plan.max_branches,
                "status": effective_status(sub) or sub.status,
                "started_at": sub.started_at.isoformat() if sub.started_at else None,
                "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
            }
        }

    def my_latest_request(self) -> dict:
        if not self.current_user.company_id:
            return {"request": None}
        r = self.requests.latest_for_company(self.current_user.company_id)
        return {"request": self._serialize_request(r) if r else None}

    # ── writes ────────────────────────────────────────────────────────────────

    def create_upgrade_request(self, data) -> dict:
        if not self.current_user.company_id:
            raise BadRequestError("No company on this user")

        plan = self.plans.get(data.plan_id)
        if not plan or not plan.is_active:
            raise NotFoundError("Plan not found")
        if plan.code == "free":
            raise BadRequestError(
                "Free is the default plan and is assigned automatically when your subscription "
                "ends. You can't request it."
            )

        if self.requests.pending_for_company(self.current_user.company_id):
            raise ConflictError(
                "You already have a pending upgrade request. Cancel it first to request a different plan."
            )

        current_sub = self.subscriptions.get_by_company(self.current_user.company_id)
        if current_sub and current_sub.plan_id == plan.id:
            raise BadRequestError("You are already on this plan.")

        req = UpgradeRequest(
            company_id=self.current_user.company_id,
            requested_plan_id=plan.id,
            current_plan_id=current_sub.plan_id if current_sub else None,
            requested_by=self.current_user.id,
            request_type=data.request_type if data.request_type in ("upgrade", "change") else "upgrade",
            billing_interval=data.billing_interval if data.billing_interval == "annual" else "monthly",
            status="pending",
            note=data.note,
        )
        with self.transaction():
            self.requests.add(req)
        self.db.refresh(req)
        company = self.current_user.company
        platform_emails.upgrade_request_filed(
            self.db, req, company=company.name if company else "A mill", plan=plan.name
        )
        return self._serialize_request(req)

    def cancel_upgrade_request(self, request_id: uuid.UUID) -> dict:
        r = self.requests.get_for_company(request_id, self.current_user.company_id)
        if not r:
            raise NotFoundError("Request not found")
        if r.status != "pending":
            raise BadRequestError(f"Cannot cancel a request that is already {r.status}.")
        with self.transaction():
            r.status = "cancelled"
            r.resolved_at = datetime.now(timezone.utc)
            r.resolved_by = self.current_user.id
        return {"message": "Request cancelled"}
