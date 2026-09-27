"""TOTP MFA (security hardening P1.9).

Enrollment is pending until a code is verified; once enabled, login becomes
two-step (password → challenge token → TOTP code → tokens). Bad codes feed the
same lockout counter as bad passwords (no-op here since tests run without Redis,
but the 401 path is what we pin).
"""

import time

import pyotp

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
    assert auth_client.post("/api/auth/mfa/disable", json={"code": "000000"}).status_code == 400
    ok = auth_client.post("/api/auth/mfa/disable", json={"code": _next_totp(secret)})
    assert ok.status_code == 200
    assert auth_client.get("/api/auth/me").json()["mfa_enabled"] is False
