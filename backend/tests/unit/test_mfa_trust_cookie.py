"""The MFA-trust cookie lives exactly as long as its token, and only for a token we signed."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import Response

from app.core.config import settings
from app.core.cookies import mfa_trust_cookie_name, set_mfa_trust_cookie


def _token(*, key: str = settings.SECRET_KEY, hours: int = 48) -> str:
    return jwt.encode(
        {
            "sub": "user",
            "type": "mfa_trust",
            "iss": settings.JWT_ISSUER,
            "aud": settings.JWT_AUDIENCE,
            "exp": datetime.now(timezone.utc) + timedelta(hours=hours),
        },
        key,
        algorithm=settings.ALGORITHM,
    )


def test_the_cookie_expires_with_the_token():
    response = Response()
    set_mfa_trust_cookie(response, _token(hours=48))
    header = response.headers["set-cookie"]
    assert header.startswith(f"{mfa_trust_cookie_name('user')}=")
    max_age = int(header.split("Max-Age=")[1].split(";")[0])
    assert abs(max_age - 48 * 3600) < 60
    assert "HttpOnly" in header


def test_a_token_signed_with_another_key_is_refused():
    with pytest.raises(jwt.InvalidSignatureError):
        set_mfa_trust_cookie(Response(), _token(key="not-the-server-key-" + "x" * 32))


def test_an_expired_token_is_refused():
    with pytest.raises(jwt.ExpiredSignatureError):
        set_mfa_trust_cookie(Response(), _token(hours=-1))
