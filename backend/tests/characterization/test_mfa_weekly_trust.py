"""2FA is asked once a week.

After a successful 2FA the device is trusted until the next Sunday 00:00 in the
user's own local time, and signing out (by hand or by the idle timer) does not
bring the prompt back before then.
"""

import time
from zoneinfo import ZoneInfo

import jwt
import pyotp

from app.core.mfa_trust import next_reset_at

LOGIN = {"username": "owner", "password": "Password123"}


def _enroll(auth_client) -> str:
    secret = auth_client.post("/api/auth/mfa/enroll").json()["secret"]
    res = auth_client.post("/api/auth/mfa/enroll/verify", json={"code": pyotp.TOTP(secret).now()})
    assert res.status_code == 200, res.text
    return secret


def _login_with_2fa(client, secret: str, **extra) -> None:
    client.cookies.clear()  # an untrusted device
    res = client.post("/api/auth/login", data=LOGIN)
    assert res.json().get("mfa_required") is True, res.text
    body = {
        "challenge_token": res.json()["challenge_token"],
        "code": pyotp.TOTP(secret).at(time.time() + 30),
        **extra,
    }
    res = client.post("/api/auth/mfa/verify", json=body)
    assert res.status_code == 200, res.text


def _trust_expires(client) -> int:
    return jwt.decode(client.cookies.get("mfa_trust"), options={"verify_signature": False})["exp"]


def _sunday(zone: str) -> int:
    return int(next_reset_at(ZoneInfo(zone)).timestamp())


def test_trust_lasts_until_sunday_in_the_browser_zone(auth_client):
    secret = _enroll(auth_client)
    before = _sunday("America/New_York")
    _login_with_2fa(auth_client, secret, timezone="America/New_York")
    assert _trust_expires(auth_client) in {before, _sunday("America/New_York")}


def test_without_a_browser_zone_the_company_zone_is_used(auth_client):
    # The seeded company keeps the default zone, Asia/Manila.
    secret = _enroll(auth_client)
    before = _sunday("Asia/Manila")
    _login_with_2fa(auth_client, secret)
    assert _trust_expires(auth_client) in {before, _sunday("Asia/Manila")}


def test_signing_out_does_not_bring_2fa_back(auth_client):
    secret = _enroll(auth_client)
    _login_with_2fa(auth_client, secret)

    res = auth_client.post("/api/auth/logout", headers={"X-CSRF-Token": auth_client.cookies.get("csrf_token")})
    assert res.status_code == 200
    assert auth_client.cookies.get("access_token", None) is None  # the session is gone
    assert auth_client.cookies.get("mfa_trust")  # the device is still trusted

    res = auth_client.post("/api/auth/login", data=LOGIN)
    assert res.status_code == 200, res.text
    assert res.json().get("mfa_required") is not True
