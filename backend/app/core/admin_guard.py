"""The locks around the BossAdmin account.

1. Confirm before changing. BossAdmin can look at anything once signed in, but
   any change (a plan, a mill's subscription, a voucher, a page's release, a
   temporary password, "View as") needs a fresh proof: the password and, with
   two-factor on, an authenticator code (POST /api/admin/confirm). The proof
   opens a short window (ADMIN_CONFIRM_MINUTES) bound to this one sign-in:
   another device, or a new sign-in, has to confirm for itself. A wrong
   password or code counts toward the sign-in lockout, like a bad login.
2. Every change BossAdmin makes, through the console or a full-control "View
   as", is written to admin_audit_log (append-only for the app's database role)
   with who, what, where from and how it ended.
3. Sign-ins to BossAdmin, failed confirmations and "View as" visits go to the
   owner's Discord security channel as they happen (core/discord.py).
4. BossAdmin never skips the authenticator at sign-in: no "trusted device".
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request

from . import discord
from .config import settings
from .database import SessionLocal
from .exceptions import PermissionDeniedError
from .ratelimit import client_ip
from .security import require_platform_admin

logger = logging.getLogger("ricemill.admin_guard")

# Where audit rows are written: a connection of their own (tests swap it).
_new_session = SessionLocal

CONFIRM_REQUIRED = "confirm_required"
_SAFE = frozenset({"GET", "HEAD", "OPTIONS"})
_TENANT_IN_PATH = re.compile(r"/tenants/([0-9a-fA-F-]{36})")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def confirmed(user, sid: str | None) -> bool:
    """Whether this sign-in has a live confirmation."""
    until = getattr(user, "admin_confirmed_until", None)
    bound = getattr(user, "admin_confirmed_sid", None)
    return bool(until and bound and sid and until > _now() and str(bound) == str(sid))


def open_window(user, sid: str) -> datetime:
    """Start the window on this sign-in. The caller commits."""
    until = _now() + timedelta(minutes=settings.ADMIN_CONFIRM_MINUTES)
    user.admin_confirmed_until = until
    user.admin_confirmed_sid = uuid.UUID(sid)
    return until


def close_window(user) -> None:
    user.admin_confirmed_until = None
    user.admin_confirmed_sid = None


def request_sid(request: Request) -> str | None:
    return (getattr(request.state, "auth_context", None) or {}).get("sid")


def require_admin_confirmed(request: Request, admin=Depends(require_platform_admin)):
    """Router dependency for /api/admin: reads pass; a change needs a live
    confirmation on this sign-in. The app catches CONFIRM_REQUIRED, asks for the
    password and code, and sends the change again."""
    if request.method in _SAFE:
        return admin
    if not confirmed(admin, request_sid(request)):
        raise PermissionDeniedError("Confirm it's you to make changes in BossAdmin.", code=CONFIRM_REQUIRED)
    return admin


def record(
    *,
    admin_id,
    admin_username: str,
    action: str,
    request: Request | None = None,
    method: str | None = None,
    path: str | None = None,
    company_id=None,
    detail: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Write one audit row on a connection of its own, so it stays even when the
    request's own work is rolled back. Never raises."""
    from ..models.platform import AdminAuditLog

    if request is not None:
        method = method or request.method
        path = path or request.url.path
        ip = ip or client_ip(request)
        user_agent = user_agent or request.headers.get("user-agent")
    if company_id is None and path:
        match = _TENANT_IN_PATH.search(path)
        company_id = match.group(1) if match else None
    try:
        company_uuid = uuid.UUID(str(company_id)) if company_id else None
    except ValueError:
        company_uuid = None
    try:
        admin_uuid = uuid.UUID(str(admin_id)) if admin_id else None
    except ValueError:
        admin_uuid = None
    db = _new_session()
    try:
        db.add(
            AdminAuditLog(
                admin_id=admin_uuid,
                admin_username=(admin_username or "?")[:50],
                action=action[:50],
                method=method,
                path=(path or "")[:300] or None,
                company_id=company_uuid,
                detail=detail,
                ip_address=(ip or "")[:45] or None,
                user_agent=(user_agent or "")[:512] or None,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001 - the audit write must never break a request
        db.rollback()
        logger.exception("could not write the BossAdmin audit log")
    finally:
        db.close()


def alert(title: str, *, request: Request | None = None, fields: list[tuple[str, str]] | None = None, color=None):
    """A message to the owner's Discord security channel."""
    rows = list(fields or [])
    if request is not None:
        rows.append(("From", f"{client_ip(request)} · {(request.headers.get('user-agent') or '?')[:200]}"))
    discord.security(discord.embed(title, fields=rows, color=color or discord.AMBER))
