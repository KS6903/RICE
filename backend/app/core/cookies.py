"""httpOnly session cookies for the web client.

The browser SPA authenticates via cookies that JavaScript cannot read, so an XSS
bug can no longer exfiltrate tokens (the pre-hardening design kept the JWT in
localStorage). The same token pair is still returned in the JSON body for the
Electron desktop app and API clients, which authenticate with a Bearer header.

Layout:
- ``access_token``  — httpOnly, path=/          (sent on every API call)
- ``refresh_token`` — httpOnly, path=/api/auth  (only sent to the auth endpoints)
- ``csrf_token``    — readable by JS, echoed back as X-CSRF-Token (double submit)

``COOKIE_SECURE`` comes from settings: false on http://localhost, enforced true
in prod by the config fail-closed validator.
"""

from __future__ import annotations

import hashlib
import time

import jwt
from fastapi import Response

from .config import settings
from .csrf import CSRF_COOKIE, new_csrf_token

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
# Scope the refresh cookie to the auth router so it never rides along on normal
# API traffic — smaller attack surface, and it can't leak via other endpoints.
REFRESH_COOKIE_PATH = "/api/auth"

# "Remember this device" for MFA: one cookie per account that passed 2FA in
# this browser, so signing in as another account doesn't cost the first one its
# trust. Like the refresh cookie, scoped to the auth router so it only ever
# rides on login/refresh, not normal API traffic.
MFA_TRUST_COOKIE = "mfa_trust"
MFA_TRUST_COOKIE_PATH = "/api/auth"


def mfa_trust_cookie_name(user_id: str) -> str:
    """One account's trust cookie. The suffix is a hash, so the name doesn't
    spell out the user's id."""
    return f"{MFA_TRUST_COOKIE}_{hashlib.sha256(str(user_id).encode()).hexdigest()[:16]}"


def is_mfa_trust_cookie(name: str) -> bool:
    """An account's trust cookie, or the single shared one browsers kept before
    there was one per account (it lapses on Sunday by itself)."""
    return name == MFA_TRUST_COOKIE or name.startswith(f"{MFA_TRUST_COOKIE}_")


def set_mfa_trust_cookie(response: Response, token: str) -> None:
    """Mark this browser as MFA-trusted for the token's account, for exactly as
    long as the token itself: until the next Sunday 00:00 in the user's local
    time (httpOnly)."""
    # We minted the token a moment ago; its exp is that Sunday boundary. Read it
    # through a verified decode anyway, so nothing here ever trusts a token's
    # claims without its signature.
    claims = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
        issuer=settings.JWT_ISSUER,
        audience=settings.JWT_AUDIENCE,
    )
    expires = claims["exp"]
    response.set_cookie(
        mfa_trust_cookie_name(claims["sub"]),
        token,
        max_age=max(1, int(expires - time.time())),
        path=MFA_TRUST_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        domain=settings.COOKIE_DOMAIN,
    )


def set_auth_cookies(response: Response, *, access_token: str, refresh_token: str) -> None:
    refresh_max_age = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    response.set_cookie(
        ACCESS_COOKIE,
        access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        domain=settings.COOKIE_DOMAIN,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=refresh_max_age,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        domain=settings.COOKIE_DOMAIN,
    )
    response.set_cookie(
        CSRF_COOKIE,
        new_csrf_token(),
        max_age=refresh_max_age,
        path="/",
        httponly=False,  # the SPA must read it to echo it as X-CSRF-Token
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        domain=settings.COOKIE_DOMAIN,
    )


def clear_auth_cookies(response: Response) -> None:
    """End the session's cookies.

    The MFA trust cookies are deliberately left alone: they belong to the device,
    not the session, so signing out (by hand or by the idle timer) doesn't bring
    the 2FA prompt back before Sunday. Logging in still needs the password, and
    the trust lapses on Sunday or as soon as MFA is disabled or re-enrolled.
    """
    response.delete_cookie(ACCESS_COOKIE, path="/", domain=settings.COOKIE_DOMAIN)
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, domain=settings.COOKIE_DOMAIN)
    response.delete_cookie(CSRF_COOKIE, path="/", domain=settings.COOKIE_DOMAIN)
