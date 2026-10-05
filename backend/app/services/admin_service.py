"""AdminService — platform (SaaS owner) operations (Phase 3, sensitive group).

Plan CRUD, tenant management + stats, subscription assignment/activation, and the
upgrade-request inbox. Reuses the shared subscription helpers and the billing
repositories; analytics queries (stats/tenants/users) live here, like reports.
Feature-cache invalidation is preserved on every entitlement-changing path.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, true
from sqlalchemy.orm import Session

from ..core import provisioning
from ..core.exceptions import AppException, BadRequestError, ConflictError, NotFoundError
from ..core.security import invalidate_company_features
from ..core.tenancy import tenant_session
from ..models.company import Branch, Company
from ..models.costs import Expense
from ..models.milling import MillingBatch
from ..models.paddy import PalayPurchase
from ..models.sales import Invoice, SalesOrder
from ..models.subscription import Subscription, SubscriptionPlan
from ..models.upgrade_request import UpgradeRequest
from ..models.user import User
from ..repositories.billing import (
    SubscriptionPlanRepository,
    SubscriptionRepository,
    UpgradeRequestRepository,
)
from ..services.activity_service import ActivityService
from ..services.base import BaseService
from ..services.subscription import (
    activate_subscription,
    backfill_free,
    effective_status,
    resolve_pending_upgrade_requests,
    sweep_expired,
)
from . import platform_emails

ALLOWED_SUB_STATUSES = {"active", "trial", "past_due", "cancelled", "expired"}


class AdminService(BaseService):
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
    def _plan_payload(p: SubscriptionPlan) -> dict:
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
    def _subscription_payload(sub: Subscription) -> dict:
        return {
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
            "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
            "notes": sub.notes,
        }

    @staticmethod
    def _upgrade_request_row(r: UpgradeRequest, company_names: dict) -> dict:
        return {
            "id": str(r.id),
            "company_id": str(r.company_id),
            "company_name": company_names.get(r.company_id),
            "requested_plan_id": str(r.requested_plan_id),
            "requested_plan_code": r.requested_plan.code if r.requested_plan else None,
            "requested_plan_name": r.requested_plan.name if r.requested_plan else None,
            "current_plan_id": str(r.current_plan_id) if r.current_plan_id else None,
            "current_plan_code": r.current_plan.code if r.current_plan else None,
            "current_plan_name": r.current_plan.name if r.current_plan else None,
            "billing_interval": r.billing_interval,
            "status": r.status,
            "note": r.note,
            "admin_note": r.admin_note,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        }

    # ── plans ─────────────────────────────────────────────────────────────────

    def list_plans(self) -> list[dict]:
        return [self._plan_payload(p) for p in self.plans.list_all()]

    def create_plan(self, data) -> dict:
        if self.plans.get_by_code(data.code):
            raise ConflictError(f"A plan with code '{data.code}' already exists")
        plan = SubscriptionPlan(
            code=data.code,
            name=data.name,
            description=data.description,
            monthly_price=data.monthly_price,
            annual_price=data.annual_price,
            max_users=data.max_users,
            max_branches=data.max_branches,
            features=data.features,
            is_active=data.is_active,
            sort_order=data.sort_order,
        )
        with self.transaction():
            self.plans.add(plan)
        self.db.refresh(plan)
        return self._plan_payload(plan)

    def update_plan(self, plan_id: uuid.UUID, data) -> dict:
        plan = self.plans.get(plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if data.code != plan.code and self.plans.get_by_code(data.code):
            raise ConflictError(f"A plan with code '{data.code}' already exists")
        with self.transaction():
            plan.code = data.code
            plan.name = data.name
            plan.description = data.description
            plan.monthly_price = data.monthly_price
            plan.annual_price = data.annual_price
            plan.max_users = data.max_users
            plan.max_branches = data.max_branches
            plan.features = data.features
            plan.is_active = data.is_active
            plan.sort_order = data.sort_order
        self.db.refresh(plan)
        # Editing a plan's features changes entitlements for every company on it.
        for cid in self.subscriptions.company_ids_on_plan(plan.id):
            invalidate_company_features(cid)
        return self._plan_payload(plan)

    def delete_plan(self, plan_id: uuid.UUID) -> dict:
        plan = self.plans.get(plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        if self.subscriptions.exists_for_plan(plan.id):
            raise ConflictError(
                "Cannot delete: this plan is currently assigned to one or more tenants. Deactivate it instead."
            )
        with self.transaction():
            self.db.delete(plan)
        return {"message": "Plan deleted"}

    # ── tenant subscriptions ──────────────────────────────────────────────────

    def get_tenant_subscription(self, tenant_id: uuid.UUID) -> dict:
        company = self.db.get(Company, tenant_id)
        if not company:
            raise NotFoundError("Tenant not found")
        sub = self.subscriptions.get_by_company(tenant_id)
        if not sub or not sub.plan:
            return {"company_id": str(tenant_id), "subscription": None}
        return {"company_id": str(tenant_id), "subscription": self._subscription_payload(sub)}

    def assign_tenant_subscription(self, tenant_id: uuid.UUID, data) -> dict:
        company = self.db.get(Company, tenant_id)
        if not company:
            raise NotFoundError("Tenant not found")
        plan = self.db.get(SubscriptionPlan, data.plan_id)
        if not plan:
            raise NotFoundError("Plan not found")
        normalized_status = data.status.strip().lower()
        if normalized_status not in ALLOWED_SUB_STATUSES:
            raise BadRequestError(f"Invalid subscription status: '{data.status}'")

        admin_id = self.current_user.id
        with self.transaction():
            if normalized_status == "active":
                sub = activate_subscription(
                    self.db,
                    company_id=company.id,
                    plan_id=plan.id,
                    admin_id=admin_id,
                    expires_at=data.expires_at,
                    notes=data.notes,
                )
            else:
                existing = self.subscriptions.get_by_company(tenant_id)
                if existing:
                    existing.plan_id = plan.id
                    existing.status = normalized_status
                    existing.expires_at = data.expires_at
                    existing.trial_ends_at = data.trial_ends_at
                    if data.notes is not None:
                        existing.notes = data.notes
                    existing.updated_by = admin_id
                    sub = existing
                else:
                    sub = Subscription(
                        company_id=company.id,
                        plan_id=plan.id,
                        status=normalized_status,
                        expires_at=data.expires_at,
                        trial_ends_at=data.trial_ends_at,
                        notes=data.notes,
                        updated_by=admin_id,
                    )
                    self.db.add(sub)
            resolve_pending_upgrade_requests(self.db, company.id, plan.id, admin_id=admin_id)
        self.db.refresh(sub)
        invalidate_company_features(company.id)
        return {
            "message": f"Tenant '{company.name}' is now on the '{plan.name}' plan",
            "plan_code": plan.code,
            "subscription": self._subscription_payload(sub),
        }

    def activate_tenant_subscription(self, tenant_id: uuid.UUID, data) -> dict:
        company = self.db.get(Company, tenant_id)
        if not company:
            raise NotFoundError("Tenant not found")

        chosen_plan: SubscriptionPlan | None = None
        if data.plan_id is not None:
            chosen_plan = self.db.get(SubscriptionPlan, data.plan_id)
            if not chosen_plan:
                raise NotFoundError("Plan not found")

        existing = self.subscriptions.get_by_company(tenant_id)
        if chosen_plan is None:
            if existing and existing.plan:
                chosen_plan = existing.plan
            else:
                chosen_plan = self.plans.get_by_code("free")
                if not chosen_plan:
                    raise AppException("No default plan found (missing 'free' plan)")

        keep_expiry = not data.clear_expiry and existing is not None and existing.expires_at is not None
        expires_at = existing.expires_at if (keep_expiry and existing is not None) else None

        admin_id = self.current_user.id
        with self.transaction():
            sub = activate_subscription(
                self.db,
                company_id=company.id,
                plan_id=chosen_plan.id,
                admin_id=admin_id,
                expires_at=expires_at,
                notes=data.notes,
            )
            resolve_pending_upgrade_requests(self.db, company.id, chosen_plan.id, admin_id=admin_id)
        self.db.refresh(sub)
        return {
            "message": f"Subscription activated for tenant '{company.name}'",
            "subscription": self._subscription_payload(sub),
        }

    # ── platform analytics ────────────────────────────────────────────────────

    def platform_stats(self) -> dict:
        db = self.db
        total_tenants = db.query(func.count(Company.id)).scalar() or 0
        total_branches = db.query(func.count(Branch.id)).scalar() or 0
        total_users = db.query(func.count(User.id)).filter(User.is_platform_admin.is_(False)).scalar() or 0
        # Domain tables now live in each client's schema — sum across all tenants.
        # Only provisioned ones: an unprovisioned tenant has no schema yet, and a
        # query against it would fail and abort the whole request's transaction.
        total_purchases = total_batches = total_orders = 0
        for company in db.query(Company).filter(Company.provisioned_at.isnot(None)).all():
            with tenant_session(db, company) as ts:
                total_purchases += ts.query(func.count(PalayPurchase.id)).scalar() or 0
                total_batches += ts.query(func.count(MillingBatch.id)).scalar() or 0
                total_orders += ts.query(func.count(SalesOrder.id)).scalar() or 0

        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        new_tenants_30d = db.query(func.count(Company.id)).filter(Company.created_at >= thirty_days_ago).scalar() or 0

        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
        active_users_7d = (
            db.query(func.count(User.id))
            .filter(
                User.is_platform_admin.is_(False),
                User.last_login >= seven_days_ago,
            )
            .scalar()
            or 0
        )

        now = datetime.now(timezone.utc)
        paid_company_ids = {
            s.company_id
            for s in db.query(Subscription).join(SubscriptionPlan, Subscription.plan_id == SubscriptionPlan.id).all()
            if s.status in ("active", "trial")
            and (s.expires_at is None or s.expires_at > now)
            and s.plan is not None
            and s.plan.code != "free"
        }
        subscribed_users = (
            db.query(func.count(User.id))
            .filter(
                User.is_platform_admin.is_(False),
                User.company_id.in_(paid_company_ids),
            )
            .scalar()
            or 0
        )
        unsubscribed_users = (
            db.query(func.count(User.id))
            .filter(
                User.is_platform_admin.is_(False),
                User.company_id.not_in(paid_company_ids) if paid_company_ids else true(),
            )
            .scalar()
            or 0
        )

        return {
            "total_tenants": total_tenants,
            "total_branches": total_branches,
            "total_users": total_users,
            "total_purchases": total_purchases,
            "total_batches": total_batches,
            "total_orders": total_orders,
            "new_tenants_30d": new_tenants_30d,
            "active_users_7d": active_users_7d,
            "subscribed_users": subscribed_users,
            "unsubscribed_users": unsubscribed_users,
        }

    def signups_trend(self, days: int = 30) -> list[dict]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        rows = (
            self.db.query(
                func.date(Company.created_at).label("date"),
                func.count(Company.id).label("count"),
            )
            .filter(Company.created_at >= cutoff)
            .group_by(func.date(Company.created_at))
            .order_by(func.date(Company.created_at))
            .all()
        )
        return [{"date": r.date.isoformat(), "count": r.count} for r in rows]

    def list_tenants(self) -> list[dict]:
        db = self.db
        companies = db.query(Company).order_by(Company.created_at.desc()).all()
        user_counts = {
            r[0]: r[1] for r in db.query(User.company_id, func.count(User.id)).group_by(User.company_id).all()
        }
        branch_counts = {
            r[0]: r[1] for r in db.query(Branch.company_id, func.count(Branch.id)).group_by(Branch.company_id).all()
        }
        sub_by_company = {s.company_id: s for s in db.query(Subscription).all()}
        # Per-client domain counts: each tenant's purchases/orders live in its own
        # schema, so visit each schema rather than one group-by over shared tables.
        purchase_counts: dict = {}
        order_counts: dict = {}
        for c in companies:
            if c.provisioned_at is None:  # no schema yet: nothing to count
                continue
            with tenant_session(db, c) as ts:
                purchase_counts[c.id] = ts.query(func.count(PalayPurchase.id)).scalar() or 0
                order_counts[c.id] = ts.query(func.count(SalesOrder.id)).scalar() or 0

        def _sub_block(cid):
            s = sub_by_company.get(cid)
            if not s or not s.plan:
                return {
                    "plan_code": None,
                    "plan_name": None,
                    "subscription_status": None,
                    "started_at": None,
                    "expires_at": None,
                    "has_subscription": False,
                }
            return {
                "plan_code": s.plan.code,
                "plan_name": s.plan.name,
                "subscription_status": effective_status(s) or s.status,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "expires_at": s.expires_at.isoformat() if s.expires_at else None,
                "has_subscription": True,
            }

        return [
            {
                "id": str(c.id),
                "name": c.name,
                "tin": c.tin,
                "phone": c.phone,
                "email": c.email,
                "is_multi_branch": c.is_multi_branch,
                "is_active": c.is_active,
                "currency": c.currency,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "users_count": user_counts.get(c.id, 0),
                "provisioning": provisioning.describe(c),
                "branches_count": branch_counts.get(c.id, 0),
                "purchases_count": purchase_counts.get(c.id, 0),
                "orders_count": order_counts.get(c.id, 0),
                **_sub_block(c.id),
            }
            for c in companies
        ]

    def retry_provisioning(self, tenant_id: uuid.UUID) -> dict:
        """Queue a tenant's schema again from scratch, clearing its failures.
        The response tells the Worker to start the provisioner at once."""
        company = self.db.get(Company, tenant_id)
        if not company:
            raise NotFoundError("Tenant not found")
        if company.provisioned_at is not None:
            raise ConflictError("This tenant is already set up.")
        with self.transaction():
            provisioning.request(company, now=datetime.now(timezone.utc))
        self.db.refresh(company)
        return provisioning.describe(company)

    def get_tenant(self, tenant_id: uuid.UUID) -> dict:
        db = self.db
        company = db.get(Company, tenant_id)
        if not company:
            raise NotFoundError("Tenant not found")
        users = db.query(User).filter(User.company_id == company.id).all()
        branches = db.query(Branch).filter(Branch.company_id == company.id).all()
        # Domain metrics live in the client's own schema; an unprovisioned tenant
        # has none yet, so its metrics are zero.
        purchases = batches = orders = invoices = 0
        expenses_total = revenue_total = 0
        if company.provisioned_at is not None:
            with tenant_session(db, company) as ts:
                purchases = ts.query(func.count(PalayPurchase.id)).scalar() or 0
                batches = ts.query(func.count(MillingBatch.id)).scalar() or 0
                orders = ts.query(func.count(SalesOrder.id)).scalar() or 0
                invoices = ts.query(func.count(Invoice.id)).scalar() or 0
                expenses_total = ts.query(func.coalesce(func.sum(Expense.amount), 0)).scalar() or 0
                revenue_total = (
                    ts.query(func.coalesce(func.sum(SalesOrder.total_amount), 0))
                    .filter(
                        SalesOrder.status.in_(["invoiced", "paid"]),
                    )
                    .scalar()
                    or 0
                )

        return {
            "company": {
                "id": str(company.id),
                "name": company.name,
                "address": company.address,
                "tin": company.tin,
                "nfa_license_no": company.nfa_license_no,
                "da_registration_no": company.da_registration_no,
                "phone": company.phone,
                "email": company.email,
                "currency": company.currency,
                "timezone": company.timezone,
                "is_multi_branch": company.is_multi_branch,
                "is_active": company.is_active,
                "created_at": company.created_at.isoformat() if company.created_at else None,
                "provisioning": provisioning.describe(company),
            },
            "users": [
                {
                    "id": str(u.id),
                    "username": u.username,
                    "full_name": u.full_name,
                    "email": u.email,
                    "role": u.role.name if u.role else None,
                    "is_active": u.is_active,
                    "last_login": u.last_login.isoformat() if u.last_login else None,
                }
                for u in users
            ],
            "branches": [
                {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch, "is_active": b.is_active}
                for b in branches
            ],
            "metrics": {
                "purchases_count": purchases,
                "batches_count": batches,
                "orders_count": orders,
                "invoices_count": invoices,
                "total_expenses": float(expenses_total),
                "total_revenue": float(revenue_total),
            },
        }

    def get_tenant_activity(self, tenant_id: uuid.UUID) -> list[dict]:
        company = self.db.get(Company, tenant_id)
        if not company:
            raise NotFoundError("Tenant not found")
        # activity_logs is a per-client table — read it from the tenant's own DB.
        with tenant_session(self.db, company) as ts:
            return ActivityService(ts).list_recent(tenant_id)

    def set_tenant_active(self, tenant_id: uuid.UUID, data) -> dict:
        company = self.db.get(Company, tenant_id)
        if not company:
            raise NotFoundError("Tenant not found")
        with self.transaction():
            company.is_active = data.is_active
        return {
            "message": f"Tenant '{company.name}' is now {'active' if data.is_active else 'inactive'}",
            "is_active": company.is_active,
        }

    def list_all_users(self) -> list[dict]:
        db = self.db
        users = db.query(User).filter(User.is_platform_admin.is_(False)).order_by(User.created_at.desc()).all()
        company_names = {r[0]: r[1] for r in db.query(Company.id, Company.name).all()}
        return [
            {
                "id": str(u.id),
                "username": u.username,
                "full_name": u.full_name,
                "email": u.email,
                "role": u.role.name if u.role else None,
                "is_active": u.is_active,
                "last_login": u.last_login.isoformat() if u.last_login else None,
                "company_id": str(u.company_id) if u.company_id else None,
                "company_name": company_names.get(u.company_id) if u.company_id else None,
            }
            for u in users
        ]

    def issue_temporary_password(self, user_id: uuid.UUID) -> dict:
        """Give a locked-out tenant user (usually a Boss who emailed for help) a
        temporary password. Platform admins are never reset here: another operator
        account is recovered by an operator, from the server."""
        user = self.db.get(User, user_id)
        if user is None or user.is_platform_admin:
            raise NotFoundError("User not found")
        if not user.is_active:
            raise BadRequestError("This user was removed. Restore them first.")
        from .auth_service import AuthService

        return AuthService(self.db, self.current_user).issue_temporary_password(user, self.current_user)

    # ── subscription maintenance ──────────────────────────────────────────────

    def sweep_expired_subscriptions(self) -> dict:
        count = sweep_expired(self.db)
        return {"message": f"Marked {count} subscription(s) as expired", "expired": count}

    def backfill_free_subscriptions(self) -> dict:
        count = backfill_free(self.db)
        return {"message": f"Backfilled Free plan for {count} tenant(s)", "backfilled": count}

    def missing_subscription_count(self) -> dict:
        count = (
            self.db.query(func.count(Company.id))
            .outerjoin(Subscription, Subscription.company_id == Company.id)
            .filter(Subscription.id.is_(None))
            .scalar()
        ) or 0
        return {"missing": int(count)}

    # ── upgrade-request inbox ─────────────────────────────────────────────────

    def list_upgrade_requests(self, status_filter: str | None = "pending") -> list[dict]:
        q = self.db.query(UpgradeRequest).order_by(UpgradeRequest.created_at.desc())
        if status_filter and status_filter != "all":
            q = q.filter(UpgradeRequest.status == status_filter)
        rows = q.all()
        company_names = {r[0]: r[1] for r in self.db.query(Company.id, Company.name).all()}
        return [self._upgrade_request_row(r, company_names) for r in rows]

    def pending_upgrade_request_count(self) -> dict:
        db = self.db
        count = db.query(func.count(UpgradeRequest.id)).filter(UpgradeRequest.status == "pending").scalar() or 0
        latest = (
            db.query(UpgradeRequest)
            .filter(UpgradeRequest.status == "pending")
            .order_by(UpgradeRequest.created_at.desc())
            .first()
        )
        latest_payload = None
        if latest:
            company_name = db.query(Company.name).filter(Company.id == latest.company_id).scalar()
            latest_payload = {
                "id": str(latest.id),
                "company_id": str(latest.company_id),
                "company_name": company_name,
                "requested_plan_name": latest.requested_plan.name if latest.requested_plan else None,
                "requested_plan_code": latest.requested_plan.code if latest.requested_plan else None,
                "created_at": latest.created_at.isoformat() if latest.created_at else None,
            }
        return {"pending": int(count), "latest": latest_payload}

    def approve_upgrade_request(self, request_id: uuid.UUID, data) -> dict:
        r = self.requests.get(request_id)
        if not r:
            raise NotFoundError("Request not found")
        if r.status != "pending":
            raise BadRequestError(f"Request is already {r.status}")
        plan = self.db.get(SubscriptionPlan, r.requested_plan_id)
        if not plan:
            raise NotFoundError("Requested plan no longer exists")

        is_plan_change = r.request_type == "change"
        admin_id = self.current_user.id
        with self.transaction():
            if is_plan_change:
                sub = self.subscriptions.get_by_company(r.company_id)
                if sub and sub.status in ("active", "trial"):
                    sub.queued_plan_id = plan.id
                else:
                    activate_subscription(self.db, company_id=r.company_id, plan_id=plan.id, admin_id=admin_id)
            else:
                activate_subscription(self.db, company_id=r.company_id, plan_id=plan.id, admin_id=admin_id)
            r.status = "approved"
            r.admin_note = data.admin_note
            r.resolved_at = datetime.now(timezone.utc)
            r.resolved_by = admin_id
            resolve_pending_upgrade_requests(self.db, r.company_id, plan.id, admin_id=admin_id)
        # A plan change waits for the current period to end, unless there was none.
        sub_now = self.subscriptions.get_by_company(r.company_id)
        queued = bool(sub_now and sub_now.queued_plan_id == plan.id)
        platform_emails.upgrade_request_decided(self.db, r, plan=plan.name, approved=True, queued=queued)
        msg = (
            f"Plan change queued — {plan.name} will activate when current subscription expires."
            if is_plan_change
            else f"Upgrade approved — tenant moved to {plan.name}"
        )
        return {"message": msg}

    def reject_upgrade_request(self, request_id: uuid.UUID, data) -> dict:
        r = self.requests.get(request_id)
        if not r:
            raise NotFoundError("Request not found")
        if r.status != "pending":
            raise BadRequestError(f"Request is already {r.status}")
        with self.transaction():
            r.status = "rejected"
            r.admin_note = data.admin_note
            r.resolved_at = datetime.now(timezone.utc)
            r.resolved_by = self.current_user.id
        plan = self.db.get(SubscriptionPlan, r.requested_plan_id)
        platform_emails.upgrade_request_decided(
            self.db, r, plan=plan.name if plan else "requested", approved=False, queued=False
        )
        return {"message": "Upgrade request rejected"}
