"""Tenant billing HTTP controllers — thin routing over BillingService (Phase 3)."""

import uuid

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.exceptions import BadRequestError
from ..core.ratelimit import limiter
from ..core.security import get_current_user, require_section_access
from ..repositories.billing import (
    SubscriptionPlanRepository,
    SubscriptionRepository,
    UpgradeRequestRepository,
)
from ..schemas.billing import CheckoutCreate, UpgradeRequestCreate, VoucherCheck, VoucherRedeem
from ..services import payment_service, vouchers
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
@limiter.limit("10/hour")
def create_upgrade_request(
    request: Request, body: UpgradeRequestCreate, svc: BillingService = Depends(get_billing_service)
):
    return svc.create_upgrade_request(body)


@router.delete("/upgrade-requests/{request_id}", dependencies=SETTINGS_WRITE)
def cancel_upgrade_request(request_id: uuid.UUID, svc: BillingService = Depends(get_billing_service)):
    return svc.cancel_upgrade_request(request_id)


# ── paying online (services/payment_service.py) ──────────────────────────────


@router.get("/payment-options")
def payment_options():
    return payment_service.options()


@router.post("/checkout", status_code=status.HTTP_201_CREATED, dependencies=SETTINGS_WRITE)
@limiter.limit("10/hour")
def start_checkout(request: Request, body: CheckoutCreate, svc: BillingService = Depends(get_billing_service)):
    return payment_service.start_checkout(
        svc,
        plan_id=body.plan_id,
        interval=body.billing_interval,
        provider=body.provider,
        voucher_code=body.voucher_code,
        proof=body,
    )


# ── vouchers (services/vouchers.py) ──────────────────────────────────────────
# Few tries an hour, so codes can't be guessed by trying them one after another.


@router.post("/vouchers/check", dependencies=SETTINGS_WRITE)
@limiter.limit("20/hour")
def check_voucher(request: Request, body: VoucherCheck, svc: BillingService = Depends(get_billing_service)):
    """What a code would give this mill, and for a plan, the price after it.
    Changes nothing."""
    if not svc.current_user.company_id:
        return {"voucher": None, "prices": None}
    voucher = vouchers.find_usable(svc.db, body.code, svc.current_user.company_id)
    out = {"voucher": vouchers.describe(voucher), "prices": None}
    if body.plan_id is not None and voucher.kind != "free_time":
        plan = svc.plans.get(body.plan_id)
        if plan is not None and plan.is_active:
            interval = "annual" if body.billing_interval == "annual" else "monthly"
            vouchers.check_for_payment(voucher, plan, interval)
            prices = {}
            for currency in ("PHP", "USD"):
                price = payment_service.price_for(plan, interval, currency)
                if price <= 0:
                    continue
                try:
                    off = vouchers.discount_for(voucher, price, currency)
                except BadRequestError:
                    continue  # this currency just isn't covered
                prices[currency] = {"price": float(price), "discount": float(off), "total": float(price - off)}
            out["prices"] = prices
    return out


@router.post("/vouchers/redeem", dependencies=SETTINGS_WRITE)
@limiter.limit("10/hour")
def redeem_voucher(request: Request, body: VoucherRedeem, svc: BillingService = Depends(get_billing_service)):
    """Free time on a plan: on at once."""
    if not svc.current_user.company_id:
        return {"redeemed": None}
    # Checked before the proof so a mistyped code doesn't spend a code from
    # the authenticator; checked again, locked, while it is used.
    voucher = vouchers.find_usable(svc.db, body.code, svc.current_user.company_id)
    if voucher.kind != "free_time":
        raise BadRequestError(
            "This voucher takes money off a payment. Type it at checkout instead.", code="voucher_discount"
        )
    svc.confirm_boss(body, reason="Redeeming a voucher")
    return {"redeemed": vouchers.redeem_free_time(svc.db, svc.current_user, body.code)}


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
