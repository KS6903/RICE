"""Paying for a plan online, and turning the plan on once the money is in.

1. start_checkout: the mill picks PayMongo (pesos) or PayPal (US dollars). A
   PlanPayment row is written, the provider makes a session for the plan's
   price, and the mill is sent to the provider's page.
2. The mill comes back to /settings/checkout/return and the page calls
   confirm; the provider's webhook may also arrive, before or after. Both only
   ask the provider where the payment stands (refresh) and act on its answer,
   so a forged webhook or a doctored return URL can't turn a plan on.
3. Paid: the plan is on at once for a month or a year (fulfil), recorded as an
   approved upgrade request so BossAdmin's history shows it, and emailed.

fulfil runs once per payment, whichever of the return page and the webhook
gets there first: it locks the row and leaves a paid one alone.
"""

from __future__ import annotations

import calendar
import json
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.exceptions import BadRequestError, NotConfiguredError, NotFoundError
from ..models.company import Company
from ..models.plan_payment import PlanPayment
from ..models.subscription import Subscription, SubscriptionPlan
from ..models.upgrade_request import UpgradeRequest
from . import payment_providers as providers
from . import platform_emails
from .billing_service import BillingService
from .subscription import activate_subscription, resolve_pending_upgrade_requests

logger = logging.getLogger("ricemill.payments")

PROVIDERS = ("paymongo", "paypal")


def options() -> dict:
    return {"paymongo": providers.paymongo_enabled(), "paypal": providers.paypal_enabled()}


def price_for(plan: SubscriptionPlan, interval: str, currency: str) -> Decimal:
    """What the plan costs for the interval. A plan with no annual price set is
    billed as 12 months, as the Billing page shows it."""
    if currency == "USD":
        monthly, annual = plan.monthly_price_usd, plan.annual_price_usd
    else:
        monthly, annual = plan.monthly_price, plan.annual_price
    monthly = Decimal(monthly or 0)
    if interval == "annual":
        return Decimal(annual) if annual and Decimal(annual) > 0 else monthly * 12
    return monthly


def _money(currency: str, amount: Decimal) -> str:
    return f"{'$' if currency == 'USD' else '₱'}{amount:,.2f}"


def _add_months(start: datetime, months: int) -> datetime:
    month = start.month - 1 + months
    year, month = start.year + month // 12, month % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


def serialize(p: PlanPayment) -> dict:
    return {
        "id": str(p.id),
        "plan_id": str(p.plan_id),
        "plan_name": p.plan_name,
        "billing_interval": p.billing_interval,
        "provider": p.provider,
        "currency": p.currency,
        "amount": float(p.amount),
        "status": p.status,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
    }


# ── the mill's side ──────────────────────────────────────────────────────────


def start_checkout(billing: BillingService, *, plan_id: uuid.UUID, interval: str, provider: str) -> dict:
    if provider not in PROVIDERS:
        raise BadRequestError("Pick PayMongo or PayPal.")
    if provider == "paymongo" and not providers.paymongo_enabled():
        raise NotConfiguredError("Paying with PayMongo isn't set up yet.")
    if provider == "paypal" and not providers.paypal_enabled():
        raise NotConfiguredError("Paying with PayPal isn't set up yet.")
    interval = "annual" if interval == "annual" else "monthly"
    plan, _ = billing.requestable_plan(plan_id)
    currency = "USD" if provider == "paypal" else "PHP"
    amount = price_for(plan, interval, currency)
    if amount <= 0:
        raise BadRequestError(
            f"The {plan.name} plan has no price in US dollars yet. Pay in pesos instead."
            if currency == "USD"
            else f"The {plan.name} plan has no price set."
        )

    user = billing.current_user
    company = billing.db.get(Company, user.company_id)
    payment = PlanPayment(
        id=uuid.uuid4(),
        company_id=user.company_id,
        company_name=company.name if company else "",
        plan_id=plan.id,
        plan_name=plan.name,
        billing_interval=interval,
        provider=provider,
        currency=currency,
        amount=amount,
        status="pending",
        created_by=user.id,
    )
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    back = f"{base}/settings/checkout/return?{urlencode({'payment': str(payment.id)})}"
    cancel = f"{base}/settings/checkout?{urlencode({'plan': str(plan.id), 'interval': interval, 'cancelled': '1'})}"
    label = f"Oraiza {plan.name} plan, {'1 year' if interval == 'annual' else '1 month'}"
    description = f"{label} for {payment.company_name}".strip()

    if provider == "paymongo":
        checkout = providers.paymongo_create_checkout(
            amount=amount,
            name=label,
            description=description,
            reference=str(payment.id),
            success_url=back,
            cancel_url=cancel,
        )
    else:
        checkout = providers.paypal_create_order(
            amount=amount, description=description, reference=str(payment.id), return_url=back, cancel_url=cancel
        )
    payment.provider_ref = checkout.ref
    payment.checkout_url = checkout.url
    with billing.transaction():
        billing.db.add(payment)
    return {"payment_id": str(payment.id), "checkout_url": checkout.url}


def confirm(db: Session, current_user: Any, payment_id: uuid.UUID) -> dict:
    """Called by the return page: the payment, refreshed from the provider."""
    payment = db.get(PlanPayment, payment_id)
    if payment is None or payment.company_id != current_user.company_id:
        raise NotFoundError("Payment not found")
    if payment.status == "pending":
        refresh(db, payment)
        db.refresh(payment)
    return serialize(payment)


# ── the provider's side ──────────────────────────────────────────────────────


def refresh(db: Session, payment: PlanPayment) -> None:
    """Ask the provider where the payment stands, and act on the answer."""
    if payment.status != "pending" or not payment.provider_ref:
        return
    if payment.provider == "paymongo":
        state = providers.paymongo_state(payment.provider_ref)
    else:
        state = providers.paypal_state(payment.provider_ref, Decimal(payment.amount))
    if state.paid:
        fulfil(db, payment.id, provider_payment_id=state.payment_id)
    elif state.failed:
        payment.status = "failed"
        db.commit()


def handle_paymongo_webhook(db: Session, raw_body: bytes, signature: str | None) -> bool:
    """A PayMongo event. Only a correctly signed one is looked at, and then only
    as a nudge to refresh that checkout session from PayMongo itself."""
    if not providers.paymongo_signature_ok(raw_body, signature):
        return False
    try:
        event = json.loads(raw_body)["data"]["attributes"]
        session_id = event["data"]["id"] if event.get("type", "").startswith("checkout_session.") else None
    except (ValueError, KeyError, TypeError):
        return True
    if session_id:
        _refresh_by_ref(db, "paymongo", session_id)
    return True


def handle_paypal_webhook(db: Session, event: dict) -> None:
    """A PayPal event: a nudge to refresh (and capture) that order from PayPal.
    Nothing in the body is trusted, so an unsigned or forged one does no harm."""
    resource = event.get("resource") or {}
    kind = event.get("event_type", "")
    if kind == "CHECKOUT.ORDER.APPROVED":
        order_id = resource.get("id")
    elif kind.startswith("PAYMENT.CAPTURE."):
        order_id = ((resource.get("supplementary_data") or {}).get("related_ids") or {}).get("order_id")
    else:
        return
    if isinstance(order_id, str):
        _refresh_by_ref(db, "paypal", order_id)


def _refresh_by_ref(db: Session, provider: str, ref: str) -> None:
    payment = db.query(PlanPayment).filter_by(provider=provider, provider_ref=ref).first()
    if payment is not None:
        refresh(db, payment)


# ── the plan ─────────────────────────────────────────────────────────────────


def fulfil(db: Session, payment_id: uuid.UUID, *, provider_payment_id: str | None) -> bool:
    """Put the mill on the plan it paid for. Once only: False if already done."""
    payment = db.query(PlanPayment).filter_by(id=payment_id).with_for_update().one()
    if payment.status == "paid":
        db.commit()
        return False
    now = datetime.now(timezone.utc)
    months = 12 if payment.billing_interval == "annual" else 1
    sub = db.query(Subscription).filter_by(company_id=payment.company_id).first() if payment.company_id else None
    # Paying again for the plan it's already on adds to the time it has left.
    start = (
        sub.expires_at if sub and sub.plan_id == payment.plan_id and sub.expires_at and sub.expires_at > now else now
    )
    expires_at = _add_months(start, months)
    amount = _money(payment.currency, Decimal(payment.amount))
    provider_name = "PayPal" if payment.provider == "paypal" else "PayMongo"

    payment.status = "paid"
    payment.paid_at = now
    payment.provider_payment_id = provider_payment_id
    if payment.company_id:
        was_paid = bool(sub and sub.plan and Decimal(sub.plan.monthly_price or 0) > 0)
        record = UpgradeRequest(
            company_id=payment.company_id,
            requested_plan_id=payment.plan_id,
            current_plan_id=sub.plan_id if sub else None,
            requested_by=payment.created_by,
            request_type="change" if was_paid else "upgrade",
            billing_interval=payment.billing_interval,
            status="approved",
            note=(
                f"Paid online: {amount} through {provider_name}, "
                f"reference {provider_payment_id or payment.provider_ref}"
            ),
            admin_note="Paid online",
            resolved_at=now,
        )
        db.add(record)
        activate_subscription(
            db,
            company_id=payment.company_id,
            plan_id=payment.plan_id,
            expires_at=expires_at,
            notes=f"Paid online through {provider_name} ({amount})",
        )
        resolve_pending_upgrade_requests(
            db, payment.company_id, payment.plan_id, auto_note="Resolved by an online payment for the plan."
        )
    db.commit()
    logger.info("plan payment %s paid: %s, %s %s", payment.id, payment.company_name, payment.plan_name, amount)
    until = f"{expires_at:%B} {expires_at.day}, {expires_at.year}"
    platform_emails.plan_payment_received(db, payment, amount=amount, until=until)
    return True
