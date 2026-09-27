"""CSRF protection (double-submit cookie pattern).

Only cookie-authenticated requests need CSRF defense: a cross-site attacker can
make the victim's browser *send* our session cookies, but cannot read or set the
``X-CSRF-Token`` header to match the ``csrf_token`` cookie (which is non-httpOnly
so the SPA can echo it back). Bearer-token clients (the Electron desktop app,
tests, API scripts) are immune — a browser can't be tricked into attaching an
Authorization header — so enforcement lives exactly on the cookie-auth path (see
``core/security.get_token`` and the cookie fallbacks in ``api/auth.py``).

Session cookies are additionally ``SameSite=Strict``, so the double-submit check
here is a second, independent layer.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, status

CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def enforce_csrf(request: Request) -> None:
    """Require a header/cookie double-submit match on mutating requests.

    Call this whenever authentication was derived from a cookie. Safe methods
    pass through (they must have no side effects).
    """
    if request.method in _SAFE_METHODS:
        return
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )
