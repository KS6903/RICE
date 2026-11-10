"""BillingService — tenant-facing billing (Phase 3). Plans, current subscription,
and the upgrade-request lifecycle. Uses the shared effective_status helper."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, ConflictError, NotFoundError, PermissionDeniedError
from ..models.subscription import Subscription, SubscriptionPlan
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
            "monthly_price_usd": float(p.monthly_price_usd),
            "annual_price_usd": float(p.annual_price_usd),
            "max_users": p.max_users,
            "max_branches": p.max_branches,
            "features": list(p.features or []),
            "is_active": p.is_active,
            "sort_order": p.sort_order,
            "payment_bank": p.payment_bank,
            "payment_account_name": p.payment_account_name,
            "payment_account_number": p.payment_account_number,
            "payment_qr_key": p.payment_qr_key,
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
            "discount": float(r.discount or 0),
            "amount_due": float(r.amount_due) if r.amount_due is not None else None,
            "paid_from": r.paid_from,
            "reference": r.reference,
            "has_receipt": bool(r.receipt_key),
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

    def confirm_boss(self, data, *, reason: str) -> None:
        """Only the Boss changes the plan, and only after typing their password
        (and an authenticator code, with two-factor on) again. Whoever else can
        open Billing only looks. A wrong password or code counts toward the
        sign-in lockout (AuthService.confirm_identity)."""
        from .auth_service import AuthService

        role = getattr(self.current_user, "role", None)
        if getattr(role, "name", None) != "owner":
            raise PermissionDeniedError("Only the Boss can change the plan.")
        AuthService(self.db, self.current_user).confirm_identity(
            getattr(data, "current_password", None), getattr(data, "mfa_code", None), reason=reason
        )

    def requestable_plan(self, plan_id: uuid.UUID) -> tuple[SubscriptionPlan, Subscription | None]:
        """The plan the mill may ask for or pay for now, and its current
        subscription. Asking (create_upgrade_request) and paying online
        (payment_service.start_checkout) refuse the same things."""
        if not self.current_user.company_id:
            raise BadRequestError("No company on this user")

        plan = self.plans.get(plan_id)
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
        return plan, current_sub

    def create_upgrade_request(self, data, receipt: bytes | None = None) -> dict:
        """Ask for a plan, usually after a bank transfer: with the reference on
        its receipt, the bank or e-wallet it came from, and (``receipt``) the
        screenshot of it. It goes to BossAdmin to check, and to the owner's
        Discord payments channel (services/payment_notices.py)."""
        from . import payment_notices, vouchers
        from .payment_service import price_for

        receipt_ext = payment_notices.check_receipt(receipt) if receipt is not None else None
        plan, current_sub = self.requestable_plan(data.plan_id)
        interval = data.billing_interval if data.billing_interval == "annual" else "monthly"
        price = price_for(plan, interval, "PHP")
        voucher, discount = vouchers.apply_to_payment(
            self.db, data.voucher_code, self.current_user.company_id, plan, interval, price, "PHP"
        )
        self.confirm_boss(data, reason="Asking for a plan")

        reference = (getattr(data, "reference", None) or "").strip() or None
        paid_from = (getattr(data, "paid_from", None) or "").strip() or None
        note = data.note
        if note is None and reference:
            note = f"Paid {'from ' + paid_from + ' ' if paid_from else ''}to {plan.payment_bank or 'the bank account'}, reference {reference}"
        request_id = uuid.uuid4()
        key = None
        if receipt is not None and receipt_ext is not None:
            key = payment_notices.receipt_key(self.current_user.company_id, request_id, receipt_ext)
            payment_notices.store_receipt(key, receipt, receipt_ext)

        req = UpgradeRequest(
            id=request_id,
            company_id=self.current_user.company_id,
            requested_plan_id=plan.id,
            current_plan_id=current_sub.plan_id if current_sub else None,
            requested_by=self.current_user.id,
            request_type=data.request_type if data.request_type in ("upgrade", "change") else "upgrade",
            billing_interval=interval,
            status="pending",
            note=note,
            voucher_id=voucher.id if voucher else None,
            discount=discount,
            amount_due=price - discount,
            paid_from=paid_from,
            reference=reference,
            receipt_key=key,
        )
        try:
            with self.transaction():
                self.requests.add(req)
        except Exception:
            if key:
                from ..core import media_store

                media_store.delete(key)
            raise
        self.db.refresh(req)
        company = self.current_user.company
        company_name = company.name if company else "A mill"
        platform_emails.upgrade_request_filed(self.db, req, company=company_name, plan=plan.name)
        user = self.current_user
        payment_notices.bank_transfer(
            company=company_name,
            requested_by=f"{user.full_name or user.username} (@{user.username})",
            plan=plan.name,
            interval=interval,
            amount_due=req.amount_due,
            discount=req.discount,
            voucher_code=vouchers.pretty(voucher.code) if voucher else None,
            reference=reference,
            paid_from=paid_from,
            paid_to=" · ".join(
                x for x in (plan.payment_bank, plan.payment_account_name, plan.payment_account_number) if x
            )
            or None,
            receipt=(receipt, receipt_ext) if receipt is not None and receipt_ext else None,
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
