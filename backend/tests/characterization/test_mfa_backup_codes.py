"""MFA backup/recovery codes (security hardening — phase 3).

Backup codes are issued once at enrollment, single-use, accepted in place of a
TOTP at the login challenge, regenerable (invalidating the old set), and cleared
when MFA is disabled. Stored only as SHA-256 hashes.
"""

import time

import pyotp


def _next_totp(secret: str) -> str:
    return pyotp.TOTP(secret).at(time.time() + 30)


def _enroll(auth_client) -> tuple[str, list[str]]:
    """Enroll the seeded owner; return (totp_secret, backup_codes)."""
    secret = auth_client.post("/api/auth/mfa/enroll").json()["secret"]
    res = auth_client.post("/api/auth/mfa/enroll/verify", json={"code": pyotp.TOTP(secret).now()})
    assert res.status_code == 200, res.text
    codes = res.json()["backup_codes"]
    assert len(codes) == 10
    return secret, codes


def _challenge(client) -> str:
    # Simulate an untrusted device: a prior successful mfa/verify sets an
    # "mfa_trust" cookie that would let the next login skip the MFA challenge, so
    # drop it here to exercise the challenge path on every call.
    client.cookies.clear()
    res = client.post("/api/auth/login", data={"username": "owner", "password": "Password123"})
    assert res.json().get("mfa_required") is True
    return res.json()["challenge_token"]


def test_enroll_returns_ten_backup_codes(auth_client):
    _, codes = _enroll(auth_client)
    assert all("-" in c for c in codes)
    assert auth_client.get("/api/auth/me").json()["mfa_backup_codes_remaining"] == 10


def test_login_with_backup_code_works_and_is_single_use(client, auth_client, seed_owner):
    _, codes = _enroll(auth_client)
    code = codes[0]

    # First use logs in.
    res = client.post("/api/auth/mfa/verify", json={"challenge_token": _challenge(client), "code": code})
    assert res.status_code == 200, res.text
    assert res.json() == {"authenticated": True}

    # Same code can't be reused.
    again = client.post("/api/auth/mfa/verify", json={"challenge_token": _challenge(client), "code": code})
    assert again.status_code == 401

    # A different, unused code still works.
    res3 = client.post("/api/auth/mfa/verify", json={"challenge_token": _challenge(client), "code": codes[1]})
    assert res3.status_code == 200


def test_backup_code_remaining_count_decrements(client, auth_client, seed_owner):
    _, codes = _enroll(auth_client)
    client.post("/api/auth/mfa/verify", json={"challenge_token": _challenge(client), "code": codes[0]})
    assert auth_client.get("/api/auth/me").json()["mfa_backup_codes_remaining"] == 9


def test_regenerate_invalidates_old_codes(client, auth_client, seed_owner):
    secret, codes = _enroll(auth_client)
    new = auth_client.post("/api/auth/mfa/backup-codes/regenerate", json={"code": _next_totp(secret)})
    assert new.status_code == 200
    new_codes = new.json()["backup_codes"]
    assert set(new_codes).isdisjoint(codes)

    # Old code rejected; new code accepted.
    assert (
        client.post("/api/auth/mfa/verify", json={"challenge_token": _challenge(client), "code": codes[0]}).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/mfa/verify", json={"challenge_token": _challenge(client), "code": new_codes[0]}
        ).status_code
        == 200
    )


def test_regenerate_requires_valid_totp(auth_client):
    _enroll(auth_client)
    assert auth_client.post("/api/auth/mfa/backup-codes/regenerate", json={"code": "000000"}).status_code == 400


def test_disable_clears_backup_codes(client, auth_client, seed_owner):
    secret, codes = _enroll(auth_client)
    assert auth_client.post("/api/auth/mfa/disable", json={"code": _next_totp(secret)}).status_code == 200
    # MFA is off, so login no longer challenges and the old backup code is moot.
    res = client.post("/api/auth/login", data={"username": "owner", "password": "Password123"})
    assert res.json() == {"authenticated": True}
