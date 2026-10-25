"""Tenant billing HTTP controllers — thin routing over BillingService (Phase 3)."""

import uuid

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.ratelimit import limiter
from ..core.security import get_current_user, require_section_access
from ..repositories.billing import (
    SubscriptionPlanRepository,
    SubscriptionRepository,
    UpgradeRequestRepository,
)
from ..schemas.billing import CheckoutCreate, UpgradeRequestCreate
from ..services import payment_service
from ..services.billing_service import BillingService

# Billing is part of the mill's settings: whoever the Boss opened Settings to
# sees it, and asking for another plan needs Settings with edit.
SETTINGS_WRITE = [Depends(require_section_access("settings", write=True))]

router = APIRouter(dependencies=[Depends(require_section_access("settings"))])


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


# Polled by every open tab: exempt from the per-IP default limit, which would
# otherwise spend Redis commands (Upstash bills per command) on every poll.
@router.get("/upgrade-requests/mine")
@limiter.exempt
def my_latest_request(svc: BillingService = Depends(get_billing_service)):
    return svc.my_latest_request()


@router.post("/upgrade-requests", status_code=status.HTTP_201_CREATED, dependencies=SETTINGS_WRITE)
def create_upgrade_request(body: UpgradeRequestCreate, svc: BillingService = Depends(get_billing_service)):
    return svc.create_upgrade_request(body)


@router.delete("/upgrade-requests/{request_id}", dependencies=SETTINGS_WRITE)
def cancel_upgrade_request(request_id: uuid.UUID, svc: BillingService = Depends(get_billing_service)):
    return svc.cancel_upgrade_request(request_id)


# ── paying online (services/payment_service.py) ──────────────────────────────


@router.get("/payment-options")
def payment_options():
    return payment_service.options()


@router.post("/checkout", status_code=status.HTTP_201_CREATED, dependencies=SETTINGS_WRITE)
def start_checkout(body: CheckoutCreate, svc: BillingService = Depends(get_billing_service)):
    return payment_service.start_checkout(
        svc, plan_id=body.plan_id, interval=body.billing_interval, provider=body.provider
    )


@router.post("/payments/{payment_id}/confirm", dependencies=SETTINGS_WRITE)
def confirm_payment(payment_id: uuid.UUID, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return payment_service.confirm(db, current_user, payment_id)


# The providers call these with no session, so they sit outside the router
# above (and its sign-in and MFA gates). Neither trusts what it is sent: each
# only prompts a look-up of that payment from the provider itself.
webhooks = APIRouter()


@webhooks.post("/paymongo")
async def paymongo_webhook(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    if not payment_service.handle_paymongo_webhook(db, raw, request.headers.get("Paymongo-Signature")):
        return JSONResponse({"detail": "Bad signature"}, status_code=status.HTTP_401_UNAUTHORIZED)
    return {"received": True}


@webhooks.post("/paypal")
async def paypal_webhook(request: Request, db: Session = Depends(get_db)):
    try:
        event = await request.json()
    except ValueError:
        return JSONResponse({"detail": "Not JSON"}, status_code=status.HTTP_400_BAD_REQUEST)
    if isinstance(event, dict):
        payment_service.handle_paypal_webhook(db, event)
    return {"received": True}
