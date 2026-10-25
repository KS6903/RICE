"""Platform-admin HTTP controllers — thin routing over AdminService (Phase 3).

Every endpoint requires is_platform_admin (enforced by the DI factory).
"""

import uuid

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.ratelimit import limiter
from ..core.security import require_platform_admin
from ..repositories.billing import (
    SubscriptionPlanRepository,
    SubscriptionRepository,
    UpgradeRequestRepository,
)
from ..schemas.admin import (
    PaymentAccountUpdate,
    PlanUpsert,
    SubscriptionActivate,
    SubscriptionAssign,
    TenantActiveToggle,
    UpgradeRequestResolution,
)
from ..services.admin_service import QR_MAX_BYTES, AdminService
from .data_backup import check_upload_size

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


# ── Payment accounts (where mills pay for each plan) ──────────────────────────


@router.put("/plans/{plan_id}/payment-account")
def update_payment_account(
    plan_id: uuid.UUID, body: PaymentAccountUpdate, svc: AdminService = Depends(get_admin_service)
):
    return svc.update_payment_account(plan_id, body)


@router.post("/plans/{plan_id}/payment-qr")
def upload_payment_qr(plan_id: uuid.UUID, file: UploadFile = File(...), svc: AdminService = Depends(get_admin_service)):
    # One byte over the limit is enough to refuse it, without reading a huge file.
    return svc.set_payment_qr(plan_id, file.file.read(QR_MAX_BYTES + 1))


@router.delete("/plans/{plan_id}/payment-qr")
def remove_payment_qr(plan_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.remove_payment_qr(plan_id)


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


@router.post("/tenants/{tenant_id}/provisioning/retry")
def retry_tenant_provisioning(tenant_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.retry_provisioning(tenant_id)


@router.get("/tenants/{tenant_id}/activity")
def get_tenant_activity(tenant_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.get_tenant_activity(tenant_id)


@router.get("/tenants/{tenant_id}/legal-acceptances")
def get_tenant_legal_acceptances(tenant_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    """Read-only: the tenant's agreement-acceptance ledger, for the platform's records."""
    return svc.get_tenant_legal_acceptances(tenant_id)


@router.get("/tenants/{tenant_id}/backup/status")
def get_tenant_backup_status(tenant_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    """Whether the tenant is empty, so a backup can be loaded into it."""
    return svc.backup_status(tenant_id)


@router.post("/tenants/{tenant_id}/backup/inspect")
@limiter.limit(settings.RATE_LIMIT_DATA_RESTORE)
def inspect_tenant_backup(
    request: Request,
    tenant_id: uuid.UUID,
    file: UploadFile = File(...),
    email: str | None = Form(default=None, max_length=100),
    svc: AdminService = Depends(get_admin_service),
):
    """What a backup holds and whether it would load into this tenant. Changes
    nothing. ``email`` is what the file was made for: the tenant Boss's own when
    left out."""
    check_upload_size(file)
    return svc.inspect_backup(tenant_id, file.file, email)


@router.post("/tenants/{tenant_id}/backup/restore")
@limiter.limit(settings.RATE_LIMIT_DATA_RESTORE)
def restore_tenant_backup(
    request: Request,
    tenant_id: uuid.UUID,
    file: UploadFile = File(...),
    email: str | None = Form(default=None, max_length=100),
    svc: AdminService = Depends(get_admin_service),
):
    """Load a backup into this empty tenant, without the owner's checks
    (data_backup.restore_as_admin). All or nothing."""
    check_upload_size(file)
    return svc.restore_backup(tenant_id, file.file, email)


@router.put("/tenants/{tenant_id}/active")
def set_tenant_active(tenant_id: uuid.UUID, body: TenantActiveToggle, svc: AdminService = Depends(get_admin_service)):
    return svc.set_tenant_active(tenant_id, body)


@router.get("/users")
def list_all_users(svc: AdminService = Depends(get_admin_service)):
    return svc.list_all_users()


# ── Subscription maintenance ──────────────────────────────────────────────────


@router.post("/users/{user_id}/temporary-password")
def issue_temporary_password(user_id: uuid.UUID, response: Response, svc: AdminService = Depends(get_admin_service)):
    """Give a locked-out user a temporary password, returned once to be passed on
    after checking who is asking. Never emailed."""
    response.headers["Cache-Control"] = "no-store"
    return svc.issue_temporary_password(user_id)


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
