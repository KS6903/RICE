"""Paying for a plan online (services/payment_service.py).

The providers are stubbed: these pin what the app does with their answers. The
plan only turns on when the provider itself says paid, once, however many
times the return page and the webhooks ask.
"""

import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.models.plan_payment import PlanPayment
from app.models.subscription import Subscription, SubscriptionPlan
from app.models.upgrade_request import UpgradeRequest
from app.services import payment_providers as providers
from app.services.payment_providers import Checkout, PaymentState


@pytest.fixture
def basic(db_session):
    plan = SubscriptionPlan(
        code="basic",
        name="Basic",
        features=["paddy"],
        is_active=True,
        sort_order=1,
        monthly_price=999,
        annual_price=9990,
        monthly_price_usd=20,
        annual_price_usd=200,
    )
    db_session.add(plan)
    db_session.flush()
    return plan


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setattr(settings, "PAYMONGO_SECRET_KEY", SecretStr("sk_test_x"))
    monkeypatch.setattr(settings, "PAYMONGO_WEBHOOK_SECRET", SecretStr("whsk_test"))
    monkeypatch.setattr(settings, "PAYPAL_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "PAYPAL_CLIENT_SECRET", SecretStr("secret"))


@pytest.fixture
def made(monkeypatch):
    """Stub the providers' "create" calls; record what they were asked for."""
    calls: list[dict] = []

    def paymongo(**kw):
        calls.append({"provider": "paymongo", **kw})
        return Checkout(ref="cs_test_1", url="https://checkout.paymongo.com/cs_test_1")

    def paypal(**kw):
        calls.append({"provider": "paypal", **kw})
        return Checkout(ref="ORDER1", url="https://www.sandbox.paypal.com/checkoutnow?token=ORDER1")

    monkeypatch.setattr(providers, "paymongo_create_checkout", paymongo)
    monkeypatch.setattr(providers, "paypal_create_order", paypal)
    return calls


def _paid(monkeypatch, *, paymongo=True, paypal=True):
    monkeypatch.setattr(providers, "paymongo_state", lambda ref: PaymentState(paid=paymongo, payment_id="pay_1"))
    monkeypatch.setattr(providers, "paypal_state", lambda ref, amount: PaymentState(paid=paypal, payment_id="CAP1"))


def _sign(body: bytes, secret: str = "whsk_test", t: str = "1700000000") -> str:
    sig = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={t},te={sig},li="


def test_options_follow_the_keys(auth_client, keys, monkeypatch):
    assert auth_client.get("/api/billing/payment-options").json() == {"paymongo": True, "paypal": True}
    monkeypatch.setattr(settings, "PAYPAL_CLIENT_ID", None)
    assert auth_client.get("/api/billing/payment-options").json() == {"paymongo": True, "paypal": False}


def test_checkout_is_refused_without_keys(auth_client, basic):
    res = auth_client.post("/api/billing/checkout", json={"plan_id": str(basic.id), "provider": "paymongo"})
    assert res.status_code == 501, res.text


def test_paymongo_checkout_charges_the_plans_price(auth_client, db_session, basic, keys, made):
    res = auth_client.post(
        "/api/billing/checkout",
        json={"plan_id": str(basic.id), "provider": "paymongo", "billing_interval": "annual"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["checkout_url"] == "https://checkout.paymongo.com/cs_test_1"
    assert made[0]["amount"] == 9990
    assert "/settings/checkout/return?payment=" in made[0]["success_url"]

    row = db_session.get(PlanPayment, uuid.UUID(res.json()["payment_id"]))
    assert (row.provider, row.currency, row.status, row.provider_ref) == ("paymongo", "PHP", "pending", "cs_test_1")


def test_paypal_charges_dollars_and_needs_a_dollar_price(auth_client, db_session, basic, keys, made):
    res = auth_client.post("/api/billing/checkout", json={"plan_id": str(basic.id), "provider": "paypal"})
    assert res.status_code == 201, res.text
    assert made[-1]["amount"] == 20

    basic.monthly_price_usd = 0
    db_session.flush()
    res = auth_client.post("/api/billing/checkout", json={"plan_id": str(basic.id), "provider": "paypal"})
    assert res.status_code == 400
    assert "US dollars" in res.json()["detail"]


def test_a_paid_checkout_turns_the_plan_on_once(auth_client, db_session, seed_owner, basic, keys, made, monkeypatch):
    pid = auth_client.post("/api/billing/checkout", json={"plan_id": str(basic.id), "provider": "paymongo"}).json()[
        "payment_id"
    ]

    _paid(monkeypatch, paymongo=False)
    assert auth_client.post(f"/api/billing/payments/{pid}/confirm").json()["status"] == "pending"
    sub = db_session.query(Subscription).filter_by(company_id=seed_owner.company_id).one()
    assert sub.plan_id != basic.id

    _paid(monkeypatch)
    body = auth_client.post(f"/api/billing/payments/{pid}/confirm").json()
    assert body["status"] == "paid"
    db_session.refresh(sub)
    assert sub.plan_id == basic.id
    assert sub.status == "active"
    # A month from now.
    assert timedelta(days=27) < sub.expires_at - datetime.now(timezone.utc) < timedelta(days=32)

    records = db_session.query(UpgradeRequest).filter_by(company_id=seed_owner.company_id).all()
    assert len(records) == 1
    assert records[0].status == "approved"
    assert "PayMongo" in records[0].note and "pay_1" in records[0].note

    # Asked again (the webhook, another tab): nothing more happens.
    assert auth_client.post(f"/api/billing/payments/{pid}/confirm").json()["status"] == "paid"
    assert db_session.query(UpgradeRequest).filter_by(company_id=seed_owner.company_id).count() == 1


def test_paymongo_webhook_needs_its_signature(auth_client, db_session, seed_owner, basic, keys, made, monkeypatch):
    auth_client.post("/api/billing/checkout", json={"plan_id": str(basic.id), "provider": "paymongo"})
    _paid(monkeypatch)
    event = {"data": {"attributes": {"type": "checkout_session.payment.paid", "data": {"id": "cs_test_1"}}}}
    raw = json.dumps(event).encode()

    forged = auth_client.post(
        "/api/billing/webhooks/paymongo", content=raw, headers={"Paymongo-Signature": _sign(raw, "wrong")}
    )
    assert forged.status_code == 401
    assert db_session.query(PlanPayment).filter_by(provider_ref="cs_test_1").one().status == "pending"

    ok = auth_client.post("/api/billing/webhooks/paymongo", content=raw, headers={"Paymongo-Signature": _sign(raw)})
    assert ok.status_code == 200, ok.text
    assert db_session.query(PlanPayment).filter_by(provider_ref="cs_test_1").one().status == "paid"
    sub = db_session.query(Subscription).filter_by(company_id=seed_owner.company_id).one()
    assert sub.plan_id == basic.id


def test_paypal_webhook_only_prompts_a_lookup(auth_client, db_session, basic, keys, made, monkeypatch):
    auth_client.post("/api/billing/checkout", json={"plan_id": str(basic.id), "provider": "paypal"})
    event = {"event_type": "CHECKOUT.ORDER.APPROVED", "resource": {"id": "ORDER1"}}

    # PayPal says not paid: the event alone changes nothing.
    _paid(monkeypatch, paypal=False)
    assert auth_client.post("/api/billing/webhooks/paypal", json=event).status_code == 200
    assert db_session.query(PlanPayment).filter_by(provider_ref="ORDER1").one().status == "pending"

    _paid(monkeypatch)
    assert auth_client.post("/api/billing/webhooks/paypal", json=event).status_code == 200
    row = db_session.query(PlanPayment).filter_by(provider_ref="ORDER1").one()
    assert (row.status, row.provider_payment_id) == ("paid", "CAP1")


def test_another_mill_cannot_confirm_a_payment(auth_client, make_auth_client, basic, keys, made):
    pid = auth_client.post("/api/billing/checkout", json={"plan_id": str(basic.id), "provider": "paymongo"}).json()[
        "payment_id"
    ]
    other = make_auth_client(features=[], username="othermill")
    assert other.post(f"/api/billing/payments/{pid}/confirm").status_code == 404


def test_signature_check():
    raw = b'{"x":1}'
    settings_secret = settings.PAYMONGO_WEBHOOK_SECRET
    try:
        settings.PAYMONGO_WEBHOOK_SECRET = SecretStr("whsk_test")
        assert providers.paymongo_signature_ok(raw, _sign(raw))
        assert not providers.paymongo_signature_ok(raw, _sign(raw, "nope"))
        assert not providers.paymongo_signature_ok(raw, None)
        assert not providers.paymongo_signature_ok(raw + b" ", _sign(raw))
    finally:
        settings.PAYMONGO_WEBHOOK_SECRET = settings_secret
