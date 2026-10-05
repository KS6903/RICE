"""MFA enforcement for privileged roles + Google-login TOTP (hardening phase 2).

When MFA_ENFORCE is on, a platform admin (and any account whose role is listed in
MFA_REQUIRED_ROLES) who hasn't enrolled is blocked (403) from every data endpoint
but can still reach /auth (me, enroll, logout). No tenant role is listed by default:
signing up never forces two-factor on a mill's owner.
A verified Google identity for an MFA-enabled account yields a TOTP challenge,
not tokens. Enforcement is disabled suite-wide (conftest); these tests opt in.
"""

import pyotp
import pytest

import app.core.config as cfg
from app.core.crypto import encrypt_str


@pytest.fixture
def enforce_mfa(monkeypatch):
    """Enforcement on, with owners and admins listed as the roles that must enroll."""
    monkeypatch.setattr(cfg.settings, "MFA_ENFORCE", True, raising=False)
    monkeypatch.setattr(cfg.settings, "MFA_REQUIRED_ROLES", "owner,admin", raising=False)
    yield


def test_a_new_owner_is_not_forced_to_set_up_two_factor_by_default(auth_client, monkeypatch):
    # Enforcement on, no role listed: the owner just signed up and goes straight in.
    monkeypatch.setattr(cfg.settings, "MFA_ENFORCE", True, raising=False)
    monkeypatch.setattr(cfg.settings, "MFA_REQUIRED_ROLES", "", raising=False)
    me = auth_client.get("/api/auth/me").json()
    assert me["mfa_enrollment_required"] is False
    assert me["mfa_required"] is False
    assert me["mfa_setup_recommended"] is True  # nudged in Settings, not blocked
    assert auth_client.get("/api/paddy/varieties").status_code == 200


def test_the_shipped_default_lists_no_tenant_role():
    assert cfg.Settings.model_fields["MFA_REQUIRED_ROLES"].default == ""


def test_a_platform_admin_must_use_two_factor_whatever_roles_are_listed(monkeypatch):
    import types

    from app.core.security import mfa_enrollment_pending, mfa_is_mandatory

    monkeypatch.setattr(cfg.settings, "MFA_ENFORCE", True, raising=False)
    monkeypatch.setattr(cfg.settings, "MFA_REQUIRED_ROLES", "", raising=False)
    admin = types.SimpleNamespace(is_platform_admin=True, role=None, mfa_enabled=False)
    owner = types.SimpleNamespace(is_platform_admin=False, role=types.SimpleNamespace(name="owner"), mfa_enabled=False)
    assert mfa_is_mandatory(admin) and mfa_enrollment_pending(admin)
    assert not mfa_is_mandatory(owner) and not mfa_enrollment_pending(owner)

    admin.mfa_enabled = True
    assert mfa_is_mandatory(admin) and not mfa_enrollment_pending(admin)

    monkeypatch.setattr(cfg.settings, "MFA_ENFORCE", False, raising=False)
    assert not mfa_is_mandatory(admin)


def test_a_listed_role_is_obliged(auth_client, enforce_mfa):
    me = auth_client.get("/api/auth/me").json()
    assert (me["mfa_required"], me["mfa_enrollment_required"]) == (True, True)


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
    monkeypatch.setattr(asvc, "google_requests", types.SimpleNamespace(Request=lambda: None), raising=False)

    res = client.post("/api/auth/google", json={"credential": "fake-google-jwt"})
    assert res.status_code == 200
    body = res.json()
    assert body.get("mfa_required") is True
    assert "access_token" not in body
