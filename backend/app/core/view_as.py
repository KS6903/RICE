"""BossAdmin's "View as": opening a mill as one of its people see it.

The platform admin picks a person in a mill. The API mints an access token for
that person which also names the admin (``act``) and is bound to the admin's own
sign-in (``sid`` is the admin's session family, checked live on every request),
and sets it in its own httpOnly cookie, ``view_as``. While that cookie is there
the browser's requests run as that person, in their mill's schema, with their
role, plan and page access. The admin's own cookies stay as they were, so ending
the visit (or its running out) goes straight back to BossAdmin.

Two modes:

- ``view``: everything is read-only. Any request that would change something is
  refused (core/security.py), and so is the live floor plan's socket.
- ``full``: the admin may do what that person can, after confirming with their
  password and an authenticator code there and then. Even so, the person's own
  sign-in (password, two-factor, email, devices: /api/auth/*) is never touched,
  and every change is written to the mill's activity log as done by BossAdmin
  and to admin_audit_log.

A visit makes no session row for the person, so it doesn't show on their
Devices list or move their "last seen". Logging out of BossAdmin, or the admin
session being revoked, ends it at once.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Request, Response

from .config import settings
from .cookies import ACCESS_COOKIE

VIEW_AS_COOKIE = "view_as"
MODES = ("view", "full")
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def request_token(request: Request) -> tuple[str | None, bool]:
    """The access token a request carries, and whether it is a "View as" one.
    A Bearer header wins; then the view_as cookie; then the session cookie."""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer ") and auth[7:].strip():
        return auth[7:].strip(), False
    view = request.cookies.get(VIEW_AS_COOKIE)
    if view:
        return view, True
    return request.cookies.get(ACCESS_COOKIE), False


def minutes_for(mode: str) -> int:
    return settings.VIEW_AS_FULL_MINUTES if mode == "full" else settings.VIEW_AS_MINUTES


def mint(target, admin, admin_sid: str, mode: str) -> tuple[str, datetime]:
    """An access token for ``target`` that names ``admin`` and lives on the
    admin's sign-in. Returns it with when it runs out."""
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=minutes_for(mode))
    payload = {
        "sub": str(target.id),
        "company_id": str(target.company_id),
        "schema": target.company.schema_name,
        "role": target.role.name if target.role else None,
        "is_platform_admin": False,
        "sid": admin_sid,
        "act": {"sub": str(admin.id), "username": admin.username},
        "view_mode": mode,
        "iat": now,
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "exp": expires,
        "type": "access",
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM), expires


def set_cookie(response: Response, token: str, mode: str) -> None:
    response.set_cookie(
        VIEW_AS_COOKIE,
        token,
        max_age=minutes_for(mode) * 60,
        path="/",
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        domain=settings.COOKIE_DOMAIN,
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(VIEW_AS_COOKIE, path="/", domain=settings.COOKIE_DOMAIN)
