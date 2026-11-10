"""A bank transfer sent with its reference, where it came from and a screenshot,
and every payment posted to the owner's Discord (services/payment_notices.py)."""

from __future__ import annotations

import pytest
from pydantic import SecretStr

from app.core import discord
from app.core.config import settings
from app.core.security import get_current_user
from app.main import app
from app.models.subscription import SubscriptionPlan
from app.models.upgrade_request import UpgradeRequest
from app.models.user import User

WEBHOOK = "https://discord.com/api/webhooks/9/payments"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def posted(monkeypatch, tmp_path):
    """Keep pictures in a temporary folder and catch what goes to Discord."""
    monkeypatch.setattr(settings, "MEDIA_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "DISCORD_PAYMENTS_WEBHOOK_URL", SecretStr(WEBHOOK))
    sent: list[tuple] = []
    monkeypatch.setattr(discord, "_post", lambda *args: sent.append(args))
    monkeypatch.setattr(
        discord.threading,
        "Thread",
        lambda target, args, **_: type("T", (), {"start": lambda self: target(*args)})(),
    )
    return sent


@pytest.fixture
def pro(db_session) -> SubscriptionPlan:
    plan = SubscriptionPlan(
        code="pro",
        name="Pro",
        features=["paddy"],
        is_active=True,
        monthly_price=2000,
        annual_price=20000,
        payment_bank="Test Bank",
        payment_account_name="Oraiza Test",
        payment_account_number="0000 1111",
    )
    db_session.add(plan)
    db_session.flush()
    return plan


def _send(auth_client, plan, picture=PNG, name="paid.png", **fields):
    form = {
        "plan_id": str(plan.id),
        "reference": "REF-778899",
        "paid_from": "GCash",
        "current_password": "Password123",
        **fields,
    }
    return auth_client.post(
        "/api/billing/upgrade-requests/with-receipt", data=form, files={"receipt": (name, picture, "image/png")}
    )


def test_a_transfer_goes_with_its_screenshot_to_bossadmin_and_discord(auth_client, db_session, pro, posted):
    res = _send(auth_client, pro)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["reference"] == "REF-778899" and body["paid_from"] == "GCash" and body["has_receipt"]

    req = db_session.get(UpgradeRequest, body["id"])
    assert req.receipt_key.startswith("payment-receipts/") and req.receipt_key.endswith(".png")
    assert "REF-778899" in req.note and "GCash" in req.note

    assert len(posted) == 1
    url, payload, files = posted[0]
    assert url == WEBHOOK
    card = payload["embeds"][0]
    fields = {f["name"]: f["value"] for f in card["fields"]}
    assert fields["Reference number"] == "REF-778899"
    assert fields["Paid from"] == "GCash"
    assert "Test Bank" in fields["Paid to"]
    assert "2,000.00" in fields["Amount due"]
    assert card["image"]["url"] == "attachment://payment-receipt.png"
    assert files[0][1] == PNG


def test_only_a_real_picture_is_taken(auth_client, pro, posted):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    res = _send(auth_client, pro, picture=svg, name="paid.png")
    assert res.status_code == 400 and res.json()["code"] == "receipt_type"
    assert posted == []


def test_the_reference_and_where_it_came_from_are_required(auth_client, pro, posted):
    assert _send(auth_client, pro, paid_from="").status_code == 422
    assert _send(auth_client, pro, reference="").status_code == 422


def test_only_bossadmin_opens_the_screenshot(client, auth_client, db_session, seed_owner, pro, posted):
    request_id = _send(auth_client, pro).json()["id"]
    key = db_session.get(UpgradeRequest, request_id).receipt_key

    # The public picture route never serves it.
    assert client.get(f"/api/media/{key}").status_code == 404
    # A mill's own login isn't BossAdmin.
    assert auth_client.get(f"/api/admin/upgrade-requests/{request_id}/receipt").status_code == 403

    ops = User(username="ops", full_name="Ops", password_hash="x", is_active=True, is_platform_admin=True)
    db_session.add(ops)
    db_session.flush()
    app.dependency_overrides[get_current_user] = lambda: ops
    res = client.get(f"/api/admin/upgrade-requests/{request_id}/receipt")
    assert res.status_code == 200
    assert res.content == PNG
    assert res.headers["content-type"] == "image/png"
    assert "no-store" in res.headers["cache-control"]
