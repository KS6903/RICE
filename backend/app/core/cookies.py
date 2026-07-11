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

from fastapi import Response

from .config import settings
from .csrf import CSRF_COOKIE, new_csrf_token

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
# Scope the refresh cookie to the auth router so it never rides along on normal
# API traffic — smaller attack surface, and it can't leak via other endpoints.
REFRESH_COOKIE_PATH = "/api/auth"

# "Remember this device" for MFA. Like the refresh cookie, scoped to the auth
# router so it only ever rides on login/refresh, not normal API traffic.
MFA_TRUST_COOKIE = "mfa_trust"
MFA_TRUST_COOKIE_PATH = "/api/auth"


def set_mfa_trust_cookie(response: Response, token: str) -> None:
    """Mark this browser as MFA-trusted until the next weekly reset (Sunday),
    matching the trust token's own expiry (httpOnly)."""
    from .mfa_trust import seconds_until_reset

    response.set_cookie(
        MFA_TRUST_COOKIE,
        token,
        max_age=seconds_until_reset(),
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
    response.delete_cookie(ACCESS_COOKIE, path="/", domain=settings.COOKIE_DOMAIN)
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, domain=settings.COOKIE_DOMAIN)
    response.delete_cookie(CSRF_COOKIE, path="/", domain=settings.COOKIE_DOMAIN)
    response.delete_cookie(
        MFA_TRUST_COOKIE,
        path=MFA_TRUST_COOKIE_PATH,
        domain=settings.COOKIE_DOMAIN,
    )
