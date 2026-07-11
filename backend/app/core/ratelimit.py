"""Rate limiting (slowapi) with graceful degradation.

One process-wide Limiter, keyed by client IP. Backed by Redis when ``REDIS_URL``
is set (so limits are shared across workers / app restarts) and falls back to
in-memory limits when Redis is unconfigured or unreachable — mirroring the cache
layer's "never a hard dependency" philosophy.

Disabled entirely when ``settings.RATE_LIMIT_ENABLED`` is false (the test suite
sets this via env), so the decorators become no-ops and runs stay deterministic.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .cache import cache
from .config import settings


def client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP.

    Behind a trusted reverse proxy the socket peer is the proxy, so by default
    everyone would share one bucket. When RATE_LIMIT_TRUST_FORWARDED_FOR is on we
    read the client IP from X-Forwarded-For, counting RATE_LIMIT_FORWARDED_HOPS
    entries from the RIGHT (the hops your own proxies appended). Entries further
    left are client-supplied and spoofable, so they're ignored — an attacker
    prepending fake IPs can't escape their own bucket. Off by default; only
    enable when actually behind a proxy you control.
    """
    if settings.RATE_LIMIT_TRUST_FORWARDED_FOR:
        xff = request.headers.get("X-Forwarded-For")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            hops = max(1, settings.RATE_LIMIT_FORWARDED_HOPS)
            if len(parts) >= hops:
                return parts[-hops]
    return get_remote_address(request)


# Empty RATE_LIMIT_DEFAULT disables the global per-IP throttle; the per-route auth
# limits still apply via their own decorators.
_default_limits: list[str | Callable[..., str]] = (
    [settings.RATE_LIMIT_DEFAULT] if settings.RATE_LIMIT_DEFAULT.strip() else []
)

limiter = Limiter(
    key_func=client_ip,
    default_limits=_default_limits,
    storage_uri=settings.REDIS_URL or "memory://",
    # Short socket timeouts so a downed Redis never adds multi-second latency to
    # auth requests. Without these, the OS TCP timeout (5–10 s) fires before
    # slowapi's in_memory_fallback kicks in. (redis-py wants floats here; the
    # limits stub types storage_options as dict[str, str], hence the ignore.)
    storage_options={"socket_connect_timeout": 0.5, "socket_timeout": 0.5} if settings.REDIS_URL else {},  # type: ignore[dict-item]
    enabled=settings.RATE_LIMIT_ENABLED,
    in_memory_fallback_enabled=True,
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


# ── Account lockout (progressive) ─────────────────────────────────────────────
# Per-username failure tracking, layered on top of the per-IP rate limit so a
# distributed brute-force (many IPs, one account) is still bounded. Backed by
# Redis; every helper degrades to a no-op when Redis is unavailable, so the
# per-IP limiter remains the floor of protection.
#
# Escalation: each lockout "round" lowers the attempt threshold (toward
# LOGIN_MIN_FAILURES) and raises the lockout duration (× LOGIN_LOCKOUT_FACTOR,
# capped). The round counter (login:round) remembers how far an attacker has
# climbed; after LOGIN_LOCKOUT_MAX_ROUNDS lockouts the account is permanently
# locked (login:perma) and only a password reset clears it.


@dataclass(frozen=True)
class LockoutState:
    """Snapshot of an account's lockout state.

    ``locked`` — login is currently refused. ``permanent`` — only a password reset
    will free it (no amount of waiting). ``retry_after`` — seconds until a *timed*
    lock expires (0 for permanent or not-locked).
    """

    locked: bool
    permanent: bool
    retry_after: int


_NOT_LOCKED = LockoutState(locked=False, permanent=False, retry_after=0)


def _normalize(username: str) -> str:
    return username.strip().lower()


def _fail_key(username: str) -> str:
    return f"login:fail:{_normalize(username)}"


def _lock_key(username: str) -> str:
    return f"login:lock:{_normalize(username)}"


def _round_key(username: str) -> str:
    return f"login:round:{_normalize(username)}"


def _perma_key(username: str) -> str:
    return f"login:perma:{_normalize(username)}"


def _attempts_allowed(round_no: int) -> int:
    """How many failures the *current* round tolerates before it locks.

    Shrinks by one each round but never below LOGIN_MIN_FAILURES, so a serial
    offender gets a tighter and tighter leash."""
    return max(settings.LOGIN_MIN_FAILURES, settings.LOGIN_MAX_FAILURES - round_no)


def _lockout_duration(round_no: int) -> int:
    """How long the lock for ``round_no`` lasts — geometric growth, capped."""
    duration = settings.LOGIN_LOCKOUT_BASE_SECONDS * (settings.LOGIN_LOCKOUT_FACTOR ** round_no)
    return min(settings.LOGIN_LOCKOUT_MAX_SECONDS, int(duration))


def login_lockout(username: str) -> LockoutState:
    """Current lockout state for ``username`` (checked before verifying a password)."""
    if cache.exists(_perma_key(username)):
        return LockoutState(locked=True, permanent=True, retry_after=0)
    remaining = cache.ttl(_lock_key(username))
    if remaining > 0:
        return LockoutState(locked=True, permanent=False, retry_after=remaining)
    return _NOT_LOCKED


def register_login_failure(username: str) -> LockoutState:
    """Count a failed login and escalate if this trips the current threshold.

    Returns the resulting LockoutState so the caller can tell the user whether (and
    for how long) they're now locked. When Redis is down every step no-ops and this
    reports "not locked" — the per-IP limiter stays the floor of protection."""
    round_no = cache.get_int(_round_key(username)) or 0
    threshold = _attempts_allowed(round_no)
    count = cache.incr(_fail_key(username), ttl=settings.LOGIN_LOCKOUT_WINDOW_SECONDS)
    if count is None or count < threshold:
        return _NOT_LOCKED

    # Threshold tripped → this round locks. Advance the round counter and clear the
    # in-window failure tally so the next round starts from a clean count.
    next_round = round_no + 1
    cache.delete(_fail_key(username))
    if next_round >= settings.LOGIN_LOCKOUT_MAX_ROUNDS:
        cache.set_int(_perma_key(username), 1, ttl=settings.LOGIN_LOCKOUT_PERMANENT_TTL_SECONDS)
        cache.delete(_round_key(username), _lock_key(username))
        return LockoutState(locked=True, permanent=True, retry_after=0)
    duration = _lockout_duration(round_no)
    cache.set_int(_round_key(username), next_round, ttl=settings.LOGIN_LOCKOUT_ROUND_TTL_SECONDS)
    cache.set_int(_lock_key(username), 1, ttl=duration)
    return LockoutState(locked=True, permanent=False, retry_after=duration)


def clear_login_failures(username: str) -> None:
    """Wipe ALL lockout state for an account — the failure tally, the active lock,
    the escalation memory, and any permanent block. Called on a successful login and
    on a password reset (the only way out of a permanent lock)."""
    cache.delete(
        _fail_key(username),
        _lock_key(username),
        _round_key(username),
        _perma_key(username),
    )
