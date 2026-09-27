"""Tenant billing HTTP controllers — thin routing over BillingService (Phase 3)."""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_roles, require_section_access
from ..repositories.billing import (
    SubscriptionPlanRepository,
    SubscriptionRepository,
    UpgradeRequestRepository,
)
from ..schemas.billing import UpgradeRequestCreate
from ..services.billing_service import BillingService

WRITE_ROLES = ("owner", "admin")

router = APIRouter(
    dependencies=[
        Depends(require_section_access("settings")),
        Depends(require_roles(*WRITE_ROLES)),
    ]
)


def get_billing_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> BillingService:
    return BillingService(
        db,
        current_user,
        plans=SubscriptionPlanRepository(db),
        subscriptions=SubscriptionRepository(db),
        requests=UpgradeRequestRepository(db),
    )


@router.get("/plans")
def list_plans_public(svc: BillingService = Depends(get_billing_service)):
    return svc.list_plans()


@router.get("/subscription")
def my_subscription(svc: BillingService = Depends(get_billing_service)):
    return svc.my_subscription()


@router.get("/upgrade-requests/mine")
def my_latest_request(svc: BillingService = Depends(get_billing_service)):
    return svc.my_latest_request()


@router.post(
    "/upgrade-requests", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(*WRITE_ROLES))]
)
def create_upgrade_request(body: UpgradeRequestCreate, svc: BillingService = Depends(get_billing_service)):
    return svc.create_upgrade_request(body)


@router.delete("/upgrade-requests/{request_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def cancel_upgrade_request(request_id: uuid.UUID, svc: BillingService = Depends(get_billing_service)):
    return svc.cancel_upgrade_request(request_id)
