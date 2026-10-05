"""TOTP MFA (security hardening P1.9).

Enrollment is pending until a code is verified; once enabled, login becomes
two-step (password → challenge token → TOTP code → tokens). Bad codes feed the
same lockout counter as bad passwords (no-op here since tests run without Redis,
but the 401 path is what we pin).
"""

import time
from zoneinfo import ZoneInfo

import pyotp
import pytest

import app.core.config as cfg
from app.services.auth_service import AuthService

PASSWORD = "Password123"  # the seeded owner's
NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


def _next_totp(secret: str) -> str:
    return pyotp.TOTP(secret).at(time.time() + 30)


def _login(client, username="owner", password="Password123"):
    return client.post("/api/auth/login", data={"username": username, "password": password})


def _enroll_and_enable(auth_client) -> str:
    """Run the full enrollment handshake; returns the TOTP secret."""
    res = auth_client.post("/api/auth/mfa/enroll")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["secret"] and body["otpauth_uri"].startswith("otpauth://totp/")

    code = pyotp.TOTP(body["secret"]).now()
    res2 = auth_client.post("/api/auth/mfa/enroll/verify", json={"code": code})
    assert res2.status_code == 200, res2.text
    return body["secret"]


def test_enroll_verify_enables_mfa(auth_client):
    _enroll_and_enable(auth_client)
    me = auth_client.get("/api/auth/me").json()
    assert me["mfa_enabled"] is True
    assert me["mfa_setup_recommended"] is False  # enrolled owner — no more nagging


def test_owner_without_mfa_is_recommended_setup(auth_client):
    me = auth_client.get("/api/auth/me").json()
    assert me["mfa_enabled"] is False
    assert me["mfa_setup_recommended"] is True  # owners should enroll


def test_enroll_verify_with_wrong_code_does_not_enable(auth_client):
    res = auth_client.post("/api/auth/mfa/enroll")
    assert res.status_code == 200
    bad = auth_client.post("/api/auth/mfa/enroll/verify", json={"code": "000000"})
    assert bad.status_code == 400
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is False


def test_login_with_mfa_returns_challenge_then_tokens(client, auth_client, seed_owner):
    secret = _enroll_and_enable(auth_client)

    # Step 1: password login no longer yields tokens — only a challenge.
    res = _login(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("mfa_required") is True
    assert "access_token" not in body

    # Step 2: challenge token + TOTP code → real tokens.
    code = _next_totp(secret)
    res2 = client.post(
        "/api/auth/mfa/verify",
        json={"challenge_token": body["challenge_token"], "code": code},
        headers=NATIVE_HEADERS,
    )
    assert res2.status_code == 200, res2.text
    assert res2.json()["access_token"]


def test_mfa_verify_rejects_wrong_code(client, auth_client, seed_owner):
    _enroll_and_enable(auth_client)
    challenge = _login(client).json()["challenge_token"]
    res = client.post(
        "/api/auth/mfa/verify",
        json={"challenge_token": challenge, "code": "000000"},
    )
    assert res.status_code == 401


def test_mfa_verify_rejects_access_token_as_challenge(client, auth_client, seed_owner):
    """A normal access token must not work as an MFA challenge (type confusion)."""
    secret = _enroll_and_enable(auth_client)
    challenge = _login(client).json()["challenge_token"]
    code = _next_totp(secret)
    tokens = client.post(
        "/api/auth/mfa/verify",
        json={"challenge_token": challenge, "code": code},
        headers=NATIVE_HEADERS,
    ).json()

    res = client.post(
        "/api/auth/mfa/verify",
        json={"challenge_token": tokens["access_token"], "code": pyotp.TOTP(secret).now()},
    )
    assert res.status_code == 401


def test_mfa_disable_requires_valid_code(auth_client):
    secret = _enroll_and_enable(auth_client)
    assert auth_client.post("/api/auth/mfa/disable", json={"code": "000000", "password": PASSWORD}).status_code == 400
    ok = auth_client.post("/api/auth/mfa/disable", json={"code": _next_totp(secret), "password": PASSWORD})
    assert ok.status_code == 200
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is False


# ── turning MFA off, and back on with the earlier authenticator or a new one ─────


def _turn_off(auth_client, secret):
    res = auth_client.post("/api/auth/mfa/disable", json={"code": _next_totp(secret), "password": PASSWORD})
    assert res.status_code == 200, res.text


def _let_time_pass(db_session, user, steps=5):
    """A code is single-use: the one that turned MFA off can't switch it back on.
    Rewind the remembered step to stand in for the minutes a person would take."""
    user.mfa_last_used_step -= steps
    db_session.flush()


def _verify(auth_client, secret):
    return auth_client.post("/api/auth/mfa/enroll/verify", json={"code": pyotp.TOTP(secret).now()})


def test_turning_mfa_off_keeps_the_earlier_authenticator_to_switch_back_on(auth_client, db_session, seed_owner):
    secret = _enroll_and_enable(auth_client)
    me = auth_client.get("/api/auth/me").json()
    assert (me["mfa_enabled"], me["mfa_previous_authenticator"], me["mfa_required"]) == (True, False, False)

    _turn_off(auth_client, secret)
    me = auth_client.get("/api/auth/me").json()
    assert me["mfa_enabled"] is False
    assert me["mfa_previous_authenticator"] is True  # it can be switched back on
    assert me["mfa_backup_codes_remaining"] == 0

    _let_time_pass(db_session, seed_owner)
    res = _verify(auth_client, secret)  # a fresh code from the same authenticator
    assert res.status_code == 200, res.text
    assert len(res.json()["backup_codes"]) == 10  # a fresh set, shown once
    me = auth_client.get("/api/auth/me").json()
    assert (me["mfa_enabled"], me["mfa_previous_authenticator"]) == (True, False)
    assert me["mfa_backup_codes_remaining"] == 10


def test_the_code_that_turned_mfa_off_cannot_switch_it_straight_back_on(auth_client):
    secret = _enroll_and_enable(auth_client)
    code = _next_totp(secret)
    assert auth_client.post("/api/auth/mfa/disable", json={"code": code, "password": PASSWORD}).status_code == 200
    res = auth_client.post("/api/auth/mfa/enroll/verify", json={"code": code})
    assert res.status_code == 400
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is False


def test_a_new_authenticator_replaces_the_earlier_one(auth_client, db_session, seed_owner):
    old = _enroll_and_enable(auth_client)
    _turn_off(auth_client, old)

    fresh = auth_client.post("/api/auth/mfa/enroll").json()["secret"]
    assert fresh != old
    # Mid-setup the earlier one is gone: nothing to switch back to, and its codes fail.
    assert auth_client.get("/api/auth/me").json()["mfa_previous_authenticator"] is False
    assert _verify(auth_client, old).status_code == 400
    assert _verify(auth_client, fresh).status_code == 200
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is True


def test_a_setup_nobody_finished_is_not_an_earlier_authenticator(auth_client):
    auth_client.post("/api/auth/mfa/enroll")  # a secret on file, never confirmed
    me = auth_client.get("/api/auth/me").json()
    assert (me["mfa_enabled"], me["mfa_previous_authenticator"]) == (False, False)


def test_nothing_to_switch_back_on_when_mfa_was_never_set_up(auth_client):
    res = auth_client.post("/api/auth/mfa/enroll/verify", json={"code": "123456"})
    assert res.status_code == 400
    assert auth_client.get("/api/auth/me").json()["mfa_previous_authenticator"] is False


def test_devices_remembered_before_mfa_was_turned_off_are_asked_again(auth_client, db_session, seed_owner):
    secret = _enroll_and_enable(auth_client)
    remembered = AuthService._mfa_trust_token(seed_owner, ZoneInfo("UTC"))
    assert AuthService._mfa_trusted(seed_owner, remembered)

    # Off and on again with the very same authenticator: the remembered device
    # must not come back to life with it.
    _turn_off(auth_client, secret)
    assert not AuthService._mfa_trusted(seed_owner, remembered)
    _let_time_pass(db_session, seed_owner)
    assert _verify(auth_client, secret).status_code == 200
    assert not AuthService._mfa_trusted(seed_owner, remembered)
    assert AuthService._mfa_trusted(seed_owner, AuthService._mfa_trust_token(seed_owner, ZoneInfo("UTC")))


def test_login_after_turning_mfa_off_asks_for_nothing_and_after_switching_on_asks_again(
    client, auth_client, db_session, seed_owner
):
    secret = _enroll_and_enable(auth_client)
    _turn_off(auth_client, secret)
    signed_in = _login(client).json()  # no second step while it is off
    assert signed_in.get("authenticated") is True and "mfa_required" not in signed_in

    _let_time_pass(db_session, seed_owner)
    assert _verify(auth_client, secret).status_code == 200
    assert _login(client).json().get("mfa_required") is True


def test_an_account_that_must_use_mfa_cannot_turn_it_off(auth_client, monkeypatch):
    monkeypatch.setattr(cfg.settings, "MFA_ENFORCE", True, raising=False)
    monkeypatch.setattr(cfg.settings, "MFA_REQUIRED_ROLES", "owner,admin", raising=False)
    secret = _enroll_and_enable(auth_client)
    me = auth_client.get("/api/auth/me").json()
    assert (me["mfa_enabled"], me["mfa_required"]) == (True, True)

    res = auth_client.post("/api/auth/mfa/disable", json={"code": _next_totp(secret), "password": PASSWORD})
    assert res.status_code == 400
    assert "required for your role" in res.json()["detail"]
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is True


@pytest.mark.parametrize("code", ["000000", ""])
def test_turning_mfa_off_still_needs_a_valid_code_and_keeps_it_on_if_not(auth_client, code):
    _enroll_and_enable(auth_client)
    assert auth_client.post("/api/auth/mfa/disable", json={"code": code, "password": PASSWORD}).status_code in (
        400,
        422,
    )
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is True


# ── turning MFA off takes the password AND a code ────────────────────────────────


def _try_to_turn_off(auth_client, code, password=PASSWORD):
    return auth_client.post("/api/auth/mfa/disable", json={"code": code, "password": password})


def test_turning_mfa_off_takes_the_password_and_a_code(auth_client):
    secret = _enroll_and_enable(auth_client)
    still_on = lambda: auth_client.get("/api/auth/me").json()["mfa_enabled"] is True  # noqa: E731

    # The right code alone is not enough, and neither is the right password alone.
    wrong_password = _try_to_turn_off(auth_client, _next_totp(secret), "Not-the-password-1")
    assert wrong_password.status_code == 400
    assert wrong_password.json()["detail"] == "Current password is incorrect."
    assert still_on()

    wrong_code = _try_to_turn_off(auth_client, "000000")
    assert wrong_code.status_code == 400
    assert wrong_code.json()["detail"] == "Invalid authentication code."
    assert still_on()

    both_wrong = _try_to_turn_off(auth_client, "000000", "Not-the-password-1")
    assert both_wrong.status_code == 400 and still_on()

    assert _try_to_turn_off(auth_client, _next_totp(secret)).status_code == 200
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is False


def test_the_password_is_not_optional_when_turning_mfa_off(auth_client):
    secret = _enroll_and_enable(auth_client)
    no_password = auth_client.post("/api/auth/mfa/disable", json={"code": _next_totp(secret)})
    assert no_password.status_code == 422
    empty = auth_client.post("/api/auth/mfa/disable", json={"code": _next_totp(secret), "password": ""})
    assert empty.status_code == 422
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is True


def test_a_wrong_password_does_not_spend_the_code(auth_client):
    # A refused attempt must not burn the code (or the step that blocks reuse), so
    # the owner can correct the password and try again with the same code.
    secret = _enroll_and_enable(auth_client)
    code = _next_totp(secret)
    assert _try_to_turn_off(auth_client, code, "Not-the-password-1").status_code == 400
    assert _try_to_turn_off(auth_client, code).status_code == 200


def test_wrong_attempts_to_turn_mfa_off_count_toward_the_login_lockout(auth_client, monkeypatch):
    import app.services.auth_service as asvc
    from app.core.ratelimit import LockoutState

    failures = []

    def tally(username):
        failures.append(username)
        return LockoutState(locked=False, permanent=False, retry_after=0)

    monkeypatch.setattr(asvc, "register_login_failure", tally)
    secret = _enroll_and_enable(auth_client)
    _try_to_turn_off(auth_client, _next_totp(secret), "Not-the-password-1")
    _try_to_turn_off(auth_client, "000000")
    assert failures == ["owner", "owner"]
    assert _try_to_turn_off(auth_client, _next_totp(secret)).status_code == 200
    assert failures == ["owner", "owner"]  # the right pair isn't a failure


def test_a_locked_out_account_cannot_try_more_passwords_through_turn_off(auth_client, monkeypatch):
    import app.services.auth_service as asvc
    from app.core.ratelimit import LockoutState

    secret = _enroll_and_enable(auth_client)
    monkeypatch.setattr(asvc, "login_lockout", lambda username: LockoutState(True, False, 60))
    res = _try_to_turn_off(auth_client, _next_totp(secret))
    assert res.status_code == 429
    monkeypatch.undo()
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is True
