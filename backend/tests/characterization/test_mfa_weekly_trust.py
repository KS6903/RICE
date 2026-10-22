"""2FA is asked once a week.

After a successful 2FA the device is trusted until the next Sunday 00:00 in the
user's own local time, and signing out (by hand or by the idle timer) does not
bring the prompt back before then. Each account keeps its own trust, so signing
in as another account on the same browser doesn't cost the first one its own.
"""

import time
import uuid
from zoneinfo import ZoneInfo

import jwt
import pyotp

from app.core.cookies import is_mfa_trust_cookie, mfa_trust_cookie_name
from app.core.mfa_trust import next_reset_at
from app.models.user import User
from app.services.auth_service import AuthService

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


def _trust_cookie(client) -> tuple[str, str]:
    """The (name, value) of the one trust cookie this browser holds."""
    [found] = [(c.name, c.value) for c in client.cookies.jar if is_mfa_trust_cookie(c.name)]
    return found


def _trust_expires(client) -> int:
    return jwt.decode(_trust_cookie(client)[1], options={"verify_signature": False})["exp"]


def _logout(client) -> None:
    res = client.post("/api/auth/logout", headers={"X-CSRF-Token": client.cookies.get("csrf_token")})
    assert res.status_code == 200


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

    _logout(auth_client)
    assert auth_client.cookies.get("access_token", None) is None  # the session is gone
    assert _trust_cookie(auth_client)  # the device is still trusted

    res = auth_client.post("/api/auth/login", data=LOGIN)
    assert res.status_code == 200, res.text
    assert res.json().get("mfa_required") is not True


def test_the_trust_cookie_belongs_to_the_account(auth_client, seed_owner):
    secret = _enroll(auth_client)
    _login_with_2fa(auth_client, secret)
    assert _trust_cookie(auth_client)[0] == mfa_trust_cookie_name(str(seed_owner.id))


def test_another_accounts_trust_on_the_same_browser_leaves_this_one_alone(auth_client):
    secret = _enroll(auth_client)
    _login_with_2fa(auth_client, secret)
    own_name, own = _trust_cookie(auth_client)
    _logout(auth_client)

    # Someone else also passed 2FA in this browser. Their trust sits beside the
    # owner's, and the single shared cookie of before may still be there too.
    other = User(id=uuid.uuid4(), mfa_secret="another-authenticator", mfa_epoch=1)
    theirs = AuthService._mfa_trust_token(other, ZoneInfo("Asia/Manila"))
    others = f"{mfa_trust_cookie_name(str(other.id))}={theirs}; mfa_trust={theirs}"

    # An explicit Cookie header stands in for the browser's whole cookie jar.
    res = auth_client.post("/api/auth/login", data=LOGIN, headers={"Cookie": f"{others}; {own_name}={own}"})
    assert res.status_code == 200, res.text
    assert res.json().get("mfa_required") is not True

    # Without the owner's own, the other account's trust doesn't let the owner in.
    res = auth_client.post("/api/auth/login", data=LOGIN, headers={"Cookie": others})
    assert res.json().get("mfa_required") is True
