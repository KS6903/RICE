"""The two online payment providers, kept to the few calls checkout needs.

PayMongo takes pesos: GCash, Maya, QR Ph, cards (foreign ones too, billed in
pesos) and online banking, on its hosted checkout page. PayPal takes US dollars
from mills abroad. Both work the same way here: create a session for a fixed
amount, send the mill to the provider's page, then ask the provider (never the
browser, never a webhook body) whether it was paid.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from dataclasses import dataclass
from decimal import Decimal

import httpx

from ..core.config import settings
from ..core.exceptions import ServiceUnavailableError

logger = logging.getLogger("ricemill.payments")

TIMEOUT_SECONDS = 20.0
PAYMONGO_API = "https://api.paymongo.com/v1"
# Offered on PayMongo's page, in this order, when the account has them turned on.
PAYMONGO_METHODS = ["qrph", "gcash", "paymaya", "card", "grab_pay", "shopee_pay", "dob", "dob_ubp"]
PAYMONGO_FALLBACK_METHODS = ["qrph", "gcash", "paymaya", "card"]


@dataclass(frozen=True)
class Checkout:
    ref: str  # the provider's session or order id
    url: str  # where the mill pays


@dataclass(frozen=True)
class PaymentState:
    paid: bool
    payment_id: str | None = None
    failed: bool = False


def paymongo_enabled() -> bool:
    return settings.PAYMONGO_SECRET_KEY is not None


def paypal_enabled() -> bool:
    return bool(settings.PAYPAL_CLIENT_ID) and settings.PAYPAL_CLIENT_SECRET is not None


def _unavailable(provider: str, exc: Exception) -> ServiceUnavailableError:
    logger.warning("%s call failed: %s", provider, exc)
    return ServiceUnavailableError(f"{provider} isn't answering right now. Try again in a minute.")


# ── PayMongo ─────────────────────────────────────────────────────────────────


def _paymongo_auth() -> dict[str, str]:
    assert settings.PAYMONGO_SECRET_KEY is not None
    token = base64.b64encode(f"{settings.PAYMONGO_SECRET_KEY.get_secret_value()}:".encode()).decode()
    return {"Authorization": f"Basic {token}", "Accept": "application/json"}


def _paymongo_methods(client: httpx.Client) -> list[str]:
    """The methods this account can take, so the session isn't refused over one
    that PayMongo hasn't turned on yet."""
    try:
        res = client.get(f"{PAYMONGO_API}/merchants/capabilities/payment_methods", headers=_paymongo_auth())
        res.raise_for_status()
        enabled = set(res.json())
        methods = [m for m in PAYMONGO_METHODS if m in enabled]
        return methods or PAYMONGO_FALLBACK_METHODS
    except (httpx.HTTPError, ValueError, TypeError):
        return PAYMONGO_FALLBACK_METHODS


def paymongo_create_checkout(
    *, amount: Decimal, name: str, description: str, reference: str, success_url: str, cancel_url: str
) -> Checkout:
    centavos = int((amount * 100).to_integral_value())
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            body = {
                "data": {
                    "attributes": {
                        "line_items": [{"name": name, "amount": centavos, "currency": "PHP", "quantity": 1}],
                        "payment_method_types": _paymongo_methods(client),
                        "description": description,
                        "reference_number": reference,
                        "metadata": {"plan_payment_id": reference},
                        "success_url": success_url,
                        "cancel_url": cancel_url,
                        "send_email_receipt": True,
                        "show_line_items": True,
                    }
                }
            }
            res = client.post(f"{PAYMONGO_API}/checkout_sessions", json=body, headers=_paymongo_auth())
            res.raise_for_status()
            data = res.json()["data"]
            return Checkout(ref=data["id"], url=data["attributes"]["checkout_url"])
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise _unavailable("PayMongo", exc) from exc


def paymongo_state(session_id: str) -> PaymentState:
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            res = client.get(f"{PAYMONGO_API}/checkout_sessions/{session_id}", headers=_paymongo_auth())
            res.raise_for_status()
            attrs = res.json()["data"]["attributes"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise _unavailable("PayMongo", exc) from exc
    for payment in attrs.get("payments") or []:
        if (payment.get("attributes") or {}).get("status") == "paid":
            return PaymentState(paid=True, payment_id=payment.get("id"))
    return PaymentState(paid=False)


def paymongo_signature_ok(raw_body: bytes, header: str | None) -> bool:
    """PayMongo signs ``<t>.<raw body>`` with the webhook's secret (HMAC-SHA256)
    and sends ``t=<t>,te=<test signature>,li=<live signature>``."""
    if not header or settings.PAYMONGO_WEBHOOK_SECRET is None:
        return False
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    timestamp = parts.get("t")
    if not timestamp:
        return False
    expected = hmac.new(
        settings.PAYMONGO_WEBHOOK_SECRET.get_secret_value().encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return any(hmac.compare_digest(expected, parts.get(k, "")) for k in ("te", "li"))


# ── PayPal ───────────────────────────────────────────────────────────────────


def _paypal_api() -> str:
    return "https://api-m.paypal.com" if settings.PAYPAL_ENV == "live" else "https://api-m.sandbox.paypal.com"


def _paypal_headers(client: httpx.Client) -> dict[str, str]:
    assert settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET is not None
    res = client.post(
        f"{_paypal_api()}/v1/oauth2/token",
        data={"grant_type": "client_credentials"},
        auth=(settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET.get_secret_value()),
    )
    res.raise_for_status()
    return {"Authorization": f"Bearer {res.json()['access_token']}", "Content-Type": "application/json"}


def paypal_create_order(
    *, amount: Decimal, description: str, reference: str, return_url: str, cancel_url: str
) -> Checkout:
    body = {
        "intent": "CAPTURE",
        "purchase_units": [
            {
                "reference_id": reference,
                "custom_id": reference,
                "description": description[:127],
                "amount": {"currency_code": "USD", "value": f"{amount:.2f}"},
            }
        ],
        "payment_source": {
            "paypal": {
                "experience_context": {
                    "brand_name": "Oraiza",
                    "user_action": "PAY_NOW",
                    "shipping_preference": "NO_SHIPPING",
                    "return_url": return_url,
                    "cancel_url": cancel_url,
                }
            }
        },
    }
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            headers = {**_paypal_headers(client), "PayPal-Request-Id": f"order-{reference}"}
            res = client.post(f"{_paypal_api()}/v2/checkout/orders", json=body, headers=headers)
            res.raise_for_status()
            data = res.json()
            url = next(link["href"] for link in data["links"] if link["rel"] in ("payer-action", "approve"))
            return Checkout(ref=data["id"], url=url)
    except (httpx.HTTPError, KeyError, ValueError, StopIteration) as exc:
        raise _unavailable("PayPal", exc) from exc


def _paypal_capture_of(order: dict, amount: Decimal) -> PaymentState:
    try:
        capture = order["purchase_units"][0]["payments"]["captures"][0]
    except (KeyError, IndexError, TypeError):
        return PaymentState(paid=False)
    got = capture.get("amount") or {}
    if capture.get("status") != "COMPLETED":
        return PaymentState(paid=False, failed=capture.get("status") in ("DECLINED", "FAILED"))
    if got.get("currency_code") != "USD" or Decimal(got.get("value", "0")) != amount:
        logger.error("PayPal order %s captured %s, expected USD %s", order.get("id"), got, amount)
        return PaymentState(paid=False)
    return PaymentState(paid=True, payment_id=capture.get("id"))


def paypal_state(order_id: str, amount: Decimal) -> PaymentState:
    """Where the order stands, capturing it once the payer has approved it.
    A PayPal order only moves money when it is captured."""
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            headers = _paypal_headers(client)
            res = client.get(f"{_paypal_api()}/v2/checkout/orders/{order_id}", headers=headers)
            res.raise_for_status()
            order = res.json()
            if order.get("status") == "APPROVED":
                res = client.post(
                    f"{_paypal_api()}/v2/checkout/orders/{order_id}/capture",
                    json={},
                    headers={**headers, "PayPal-Request-Id": f"capture-{order_id}"},
                )
                if res.status_code == 422:  # captured meanwhile (the webhook or another tab)
                    res = client.get(f"{_paypal_api()}/v2/checkout/orders/{order_id}", headers=headers)
                res.raise_for_status()
                order = res.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise _unavailable("PayPal", exc) from exc
    if order.get("status") == "VOIDED":
        return PaymentState(paid=False, failed=True)
    if order.get("status") != "COMPLETED":
        return PaymentState(paid=False)
    return _paypal_capture_of(order, amount)
