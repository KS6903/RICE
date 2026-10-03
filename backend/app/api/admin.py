"""Platform-admin HTTP controllers — thin routing over AdminService (Phase 3).

Every endpoint requires is_platform_admin (enforced by the DI factory).
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.ratelimit import limiter
from ..core.security import require_platform_admin
from ..repositories.billing import (
    SubscriptionPlanRepository,
    SubscriptionRepository,
    UpgradeRequestRepository,
)
from ..schemas.admin import (
    PlanUpsert,
    SubscriptionActivate,
    SubscriptionAssign,
    TenantActiveToggle,
    UpgradeRequestResolution,
)
from ..services.admin_service import AdminService

router = APIRouter()


def get_admin_service(
    db: Session = Depends(get_db),
    admin=Depends(require_platform_admin),
) -> AdminService:
    return AdminService(
        db,
        admin,
        plans=SubscriptionPlanRepository(db),
        subscriptions=SubscriptionRepository(db),
        requests=UpgradeRequestRepository(db),
    )


# ── Plans ─────────────────────────────────────────────────────────────────────


@router.get("/plans")
def list_plans(svc: AdminService = Depends(get_admin_service)):
    return svc.list_plans()


@router.post("/plans", status_code=status.HTTP_201_CREATED)
def create_plan(body: PlanUpsert, svc: AdminService = Depends(get_admin_service)):
    return svc.create_plan(body)


@router.put("/plans/{plan_id}")
def update_plan(plan_id: uuid.UUID, body: PlanUpsert, svc: AdminService = Depends(get_admin_service)):
    return svc.update_plan(plan_id, body)


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.delete_plan(plan_id)


# ── Tenant subscriptions ──────────────────────────────────────────────────────


@router.get("/tenants/{tenant_id}/subscription")
def get_tenant_subscription(tenant_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.get_tenant_subscription(tenant_id)


@router.put("/tenants/{tenant_id}/subscription")
def assign_tenant_subscription(
    tenant_id: uuid.UUID, body: SubscriptionAssign, svc: AdminService = Depends(get_admin_service)
):
    return svc.assign_tenant_subscription(tenant_id, body)


@router.post("/tenants/{tenant_id}/subscription/activate")
def activate_tenant_subscription(
    tenant_id: uuid.UUID, body: SubscriptionActivate, svc: AdminService = Depends(get_admin_service)
):
    return svc.activate_tenant_subscription(tenant_id, body)


# ── Platform analytics ────────────────────────────────────────────────────────


@router.get("/stats")
def platform_stats(svc: AdminService = Depends(get_admin_service)):
    return svc.platform_stats()


@router.get("/signups-trend")
def signups_trend(days: int = 30, svc: AdminService = Depends(get_admin_service)):
    return svc.signups_trend(days)


@router.get("/tenants")
def list_tenants(svc: AdminService = Depends(get_admin_service)):
    return svc.list_tenants()


@router.get("/tenants/{tenant_id}")
def get_tenant(tenant_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.get_tenant(tenant_id)


@router.get("/tenants/{tenant_id}/activity")
def get_tenant_activity(tenant_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.get_tenant_activity(tenant_id)


@router.put("/tenants/{tenant_id}/active")
def set_tenant_active(tenant_id: uuid.UUID, body: TenantActiveToggle, svc: AdminService = Depends(get_admin_service)):
    return svc.set_tenant_active(tenant_id, body)


@router.get("/users")
def list_all_users(svc: AdminService = Depends(get_admin_service)):
    return svc.list_all_users()


# ── Subscription maintenance ──────────────────────────────────────────────────


@router.post("/subscriptions/sweep-expired")
def sweep_expired_subscriptions(svc: AdminService = Depends(get_admin_service)):
    return svc.sweep_expired_subscriptions()


@router.post("/subscriptions/backfill-free")
def backfill_free_subscriptions(svc: AdminService = Depends(get_admin_service)):
    return svc.backfill_free_subscriptions()


@router.get("/subscriptions/missing-count")
def missing_subscription_count(svc: AdminService = Depends(get_admin_service)):
    return svc.missing_subscription_count()


# ── Upgrade-request inbox ─────────────────────────────────────────────────────


@router.get("/upgrade-requests")
def list_upgrade_requests(status_filter: str | None = "pending", svc: AdminService = Depends(get_admin_service)):
    return svc.list_upgrade_requests(status_filter)


# Polled by every open tab: exempt from the per-IP default limit, which would
# otherwise spend Redis commands (Upstash bills per command) on every poll.
@router.get("/upgrade-requests/pending-count")
@limiter.exempt
def pending_upgrade_request_count(svc: AdminService = Depends(get_admin_service)):
    return svc.pending_upgrade_request_count()


@router.post("/upgrade-requests/{request_id}/approve")
def approve_upgrade_request(
    request_id: uuid.UUID, body: UpgradeRequestResolution, svc: AdminService = Depends(get_admin_service)
):
    return svc.approve_upgrade_request(request_id, body)


@router.post("/upgrade-requests/{request_id}/reject")
def reject_upgrade_request(
    request_id: uuid.UUID, body: UpgradeRequestResolution, svc: AdminService = Depends(get_admin_service)
):
    return svc.reject_upgrade_request(request_id, body)
