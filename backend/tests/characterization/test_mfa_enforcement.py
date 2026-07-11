"""MFA enforcement for privileged roles + Google-login TOTP (hardening phase 2).

When MFA_ENFORCE is on, an owner/platform-admin who hasn't enrolled is blocked
(403) from every data endpoint but can still reach /auth (me, enroll, logout).
A verified Google identity for an MFA-enabled account yields a TOTP challenge,
not tokens. Enforcement is disabled suite-wide (conftest); these tests opt in.
"""
import pyotp
import pytest

import app.core.config as cfg
from app.core.crypto import encrypt_str


@pytest.fixture
def enforce_mfa(monkeypatch):
    monkeypatch.setattr(cfg.settings, "MFA_ENFORCE", True, raising=False)
    yield


def test_unenrolled_owner_is_blocked_from_data_endpoints(auth_client, enforce_mfa):
    # /me stays reachable and advertises the requirement…
    me = auth_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["mfa_enrollment_required"] is True
    # …but a gated data endpoint is refused until enrollment completes.
    assert auth_client.get("/api/paddy/varieties").status_code == 403


def test_enrolling_lifts_the_block(auth_client, enforce_mfa):
    secret = auth_client.post("/api/auth/mfa/enroll").json()["secret"]
    code = pyotp.TOTP(secret).now()
    assert auth_client.post("/api/auth/mfa/enroll/verify", json={"code": code}).status_code == 200

    # Now data endpoints work and the gate clears.
    assert auth_client.get("/api/paddy/varieties").status_code == 200
    assert auth_client.get("/api/auth/me").json()["mfa_enrollment_required"] is False


def test_enforcement_off_allows_unenrolled_owner(auth_client):
    # Default (MFA_ENFORCE=false in conftest): no block, flag is false.
    assert auth_client.get("/api/paddy/varieties").status_code == 200
    assert auth_client.get("/api/auth/me").json()["mfa_enrollment_required"] is False


def test_google_login_with_mfa_returns_challenge(client, seed_owner, db_session, monkeypatch):
    import types

    import app.services.auth_service as asvc

    # Enable MFA on the seeded owner.
    seed_owner.mfa_enabled = True
    seed_owner.mfa_secret = encrypt_str(pyotp.random_base32())
    seed_owner.google_sub = "google-owner-sub"
    seed_owner.google_issuer = "accounts.google.com"
    db_session.flush()

    # Stub the Google SDK on the module itself, so the test is hermetic: it must
    # pass whether or not google-auth (and its requests transport) is importable.
    monkeypatch.setattr(cfg.settings, "GOOGLE_CLIENT_ID", "test-client", raising=False)
    monkeypatch.setattr(
        asvc,
        "id_token",
        types.SimpleNamespace(
            verify_oauth2_token=lambda *a, **k: {
                "email": seed_owner.email,
                "name": seed_owner.full_name,
                "sub": "google-owner-sub",
                "iss": "accounts.google.com",
                "email_verified": True,
            }
        ),
        raising=False,
    )
    monkeypatch.setattr(
        asvc, "google_requests", types.SimpleNamespace(Request=lambda: None), raising=False
    )

    res = client.post("/api/auth/google", json={"credential": "fake-google-jwt"})
    assert res.status_code == 200
    body = res.json()
    assert body.get("mfa_required") is True
    assert "access_token" not in body
