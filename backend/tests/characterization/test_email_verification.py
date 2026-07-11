"""Email verification + enumeration-safe signup (security hardening — phase 7).

Signup creates an unverified account and issues a tokenized verification link;
verifying flips email_verified. When REQUIRE_EMAIL_VERIFICATION is on, data
endpoints are blocked until the address is confirmed. Signup uses one generic
conflict message so it can't be used to probe which emails/usernames exist.
Enforcement + token exposure are off by default; these tests opt in.
"""
import pytest

import app.core.config as cfg
from app.models.subscription import SubscriptionPlan
from app.models.user import Role

NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


@pytest.fixture
def expose_token(monkeypatch):
    monkeypatch.setattr(cfg.settings, "EXPOSE_RESET_TOKEN", True, raising=False)


@pytest.fixture
def require_email(monkeypatch):
    monkeypatch.setattr(cfg.settings, "REQUIRE_EMAIL_VERIFICATION", True, raising=False)


def _prereqs(db):
    db.add(Role(id=1, name="owner"))
    db.add(SubscriptionPlan(code="free", name="Free", features=[]))
    db.flush()


def _signup(client, username="newowner", email="newowner@gmail.com"):
    return client.post(
        "/api/auth/signup",
        headers=NATIVE_HEADERS,
        json={
            "company_name": "NewCo", "full_name": "New Owner",
            "username": username, "email": email, "password": "password123",
        },
    )


def _bearer(tokens):
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def test_signup_is_enumeration_safe(client, db_session):
    _prereqs(db_session)
    assert _signup(client, "alice", "alice@x.com").status_code == 201
    client.cookies.clear()

    dup_email = _signup(client, "bob", "alice@x.com")   # email clash
    dup_user = _signup(client, "alice", "bob@x.com")    # username clash
    assert dup_email.status_code == 409 and dup_user.status_code == 409
    # Identical generic message — doesn't reveal which field (or that the email exists).
    assert dup_email.json()["detail"] == dup_user.json()["detail"]
    detail = dup_email.json()["detail"].lower()
    assert "email" not in detail and "username" not in detail


def test_signup_creates_unverified_account_then_verifies(client, db_session, expose_token):
    _prereqs(db_session)
    tokens = _signup(client).json()
    client.cookies.clear()
    h = _bearer(tokens)

    assert client.get("/api/auth/me", headers=h).json()["email_verified"] is False
    token = client.post("/api/auth/resend-verification", headers=h).json()["verification_token"]
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert client.get("/api/auth/me", headers=h).json()["email_verified"] is True


def test_verify_email_rejects_bad_token(client, db_session):
    _prereqs(db_session)
    _signup(client)
    client.cookies.clear()
    assert client.post("/api/auth/verify-email", json={"token": "not-a-real-token"}).status_code == 400


def test_resend_is_idempotent_once_verified(client, db_session, expose_token):
    _prereqs(db_session)
    tokens = _signup(client).json()
    client.cookies.clear()
    h = _bearer(tokens)

    token = client.post("/api/auth/resend-verification", headers=h).json()["verification_token"]
    client.post("/api/auth/verify-email", json={"token": token})
    again = client.post("/api/auth/resend-verification", headers=h)
    assert again.status_code == 200
    assert "verification_token" not in again.json()  # already verified — nothing re-issued


def test_enforcement_blocks_data_until_verified(auth_client, expose_token, require_email):
    me = auth_client.get("/api/auth/me").json()
    assert me["email_verified"] is False and me["email_verification_required"] is True
    assert auth_client.get("/api/paddy/varieties").status_code == 403  # gated

    token = auth_client.post("/api/auth/resend-verification").json()["verification_token"]
    assert auth_client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert auth_client.get("/api/paddy/varieties").status_code == 200  # unblocked


def test_enforcement_off_by_default(auth_client):
    assert auth_client.get("/api/auth/me").json()["email_verification_required"] is False
    assert auth_client.get("/api/paddy/varieties").status_code == 200
