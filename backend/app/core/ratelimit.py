"""Rate limiting (slowapi) with graceful degradation.

One process-wide Limiter, keyed by client IP. Backed by Redis when ``REDIS_URL``
is set (so limits are shared across workers / app restarts) and falls back to
in-memory limits when Redis is unconfigured or unreachable — mirroring the cache
layer's "never a hard dependency" philosophy.

Disabled entirely when ``settings.RATE_LIMIT_ENABLED`` is false (the test suite
sets this via env), so the decorators become no-ops and runs stay deterministic.
"""
from __future__ import annotations

from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .cache import cache
from .config import settings

# Empty RATE_LIMIT_DEFAULT disables the global per-IP throttle; the per-route auth
# limits still apply via their own decorators.
_default_limits: list[str | Callable[..., str]] = (
    [settings.RATE_LIMIT_DEFAULT] if settings.RATE_LIMIT_DEFAULT.strip() else []
)

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=_default_limits,
    storage_uri=settings.REDIS_URL or "memory://",
    enabled=settings.RATE_LIMIT_ENABLED,
    # If Redis storage goes down at runtime, keep enforcing limits in-memory
    # instead of failing the request.
    in_memory_fallback_enabled=True,
    # Never let a limiter-internal error turn into a 500 for the user.
    swallow_errors=True,
    headers_enabled=True,
)

# The auth-endpoint limit string, resolved once for the route decorators.
AUTH_RATE_LIMIT = settings.RATE_LIMIT_AUTH


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Render a 429 in the app's ``{"detail", "code"}`` envelope."""
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please slow down and try again shortly.",
            "code": "rate_limited",
        },
    )


# ── Account lockout ───────────────────────────────────────────────────────────
# Per-username failure tracking, layered on top of the per-IP rate limit so a
# distributed brute-force (many IPs, one account) is still bounded. Backed by
# Redis; every helper degrades to a no-op when Redis is unavailable, so the
# per-IP limiter remains the floor of protection.


def _normalize(username: str) -> str:
    return username.strip().lower()


def _fail_key(username: str) -> str:
    return f"login:fail:{_normalize(username)}"


def _lock_key(username: str) -> str:
    return f"login:lock:{_normalize(username)}"


def is_locked_out(username: str) -> bool:
    """True if the account is currently locked from too many failed logins."""
    return cache.exists(_lock_key(username))


def register_login_failure(username: str) -> None:
    """Count a failed login; lock the account once the threshold is reached."""
    count = cache.incr(_fail_key(username), ttl=settings.LOGIN_LOCKOUT_SECONDS)
    if count is not None and count >= settings.LOGIN_MAX_FAILURES:
        cache.set_int(_lock_key(username), 1, ttl=settings.LOGIN_LOCKOUT_SECONDS)
        cache.delete(_fail_key(username))


def clear_login_failures(username: str) -> None:
    """Reset the failure counter and lock on a successful authentication."""
    cache.delete(_fail_key(username), _lock_key(username))
