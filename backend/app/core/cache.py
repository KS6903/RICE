"""Redis cache layer — cache-aside with graceful degradation.

Industry-standard pattern: Redis is a *performance optimization*, never a
correctness dependency. Every operation degrades gracefully — if Redis is
unconfigured or unreachable, reads return ``None`` (treated as a cache miss)
and writes become no-ops, so callers transparently fall back to PostgreSQL.

A lightweight circuit breaker keeps a *down* Redis from adding connection
latency to every request: after a failure we stop trying for a short cooldown
window, then probe again. This means an outage costs one ~0.5s timeout every
``_BREAKER_COOLDOWN`` seconds instead of on every request.

Usage:
    from ..core.cache import cache

    data = cache.get_json("features:123")           # None on miss / Redis down
    cache.set_json("features:123", [...], ttl=60)   # no-op when Redis down
    cache.delete("features:123")                    # invalidate

    # or read-through in one call:
    features = cache.get_or_set("features:123", 60, lambda: load_from_db())
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable

from .config import settings

logger = logging.getLogger("ricemill.cache")

try:
    import redis as _redis
except ImportError:  # redis package not installed — cache silently disabled
    _redis = None

# All keys are namespaced so this app never collides with anything else sharing
# the same Redis instance.
_KEY_PREFIX = "ricemill:"

# How long to stop talking to Redis after a connection/op failure before we
# probe it again. Keeps a downed cache from slowing every request.
_BREAKER_COOLDOWN = 30.0

# Semantic TTLs (seconds). Kept here so cache lifetimes live in one place.
TTL_FEATURES = 60  # plan entitlements — short; bounded staleness on plan changes
TTL_WEATHER = 10 * 60  # current weather — matches the upstream's freshness
TTL_WEATHER_FORECAST = 30 * 60  # hourly/daily forecast — changes slowly, heavier call
TTL_IP_GEO = 60 * 60  # IP → coordinates — public IPs move rarely
TTL_DRYING_ADVISORY = 3 * 60 * 60  # LLM advisory — expensive; refreshed a few times/day


class _Cache:
    """Process-wide Redis handle. Construct once (module singleton below)."""

    def __init__(self) -> None:
        self._client: Any = None
        self._down_until: float = 0.0
        # Decided once at import: no redis lib, or no URL configured → stay off.
        self._permanently_off: bool = _redis is None or not settings.REDIS_URL
        if _redis is None and settings.REDIS_URL:
            logger.warning("REDIS_URL is set but the 'redis' package is not installed; cache disabled.")
        elif not settings.REDIS_URL:
            logger.info("REDIS_URL not set — running without cache (reads go straight to PostgreSQL).")

    # ---- connection management ------------------------------------------------

    def _client_or_none(self):
        """Return a live client, or None if Redis is off / cooling down / unreachable."""
        if self._permanently_off:
            return None
        now = time.monotonic()
        if now < self._down_until:
            return None
        if self._client is not None:
            return self._client
        try:
            client = _redis.from_url(
                settings.REDIS_URL,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
                decode_responses=True,
            )
            client.ping()
        except Exception as e:  # noqa: BLE001 — any failure → degrade, don't crash
            logger.warning("Redis unavailable (%s); falling back to DB for ~%.0fs.", e, _BREAKER_COOLDOWN)
            self._down_until = now + _BREAKER_COOLDOWN
            self._client = None
            return None
        self._client = client
        logger.info("Redis cache connected.")
        return client

    def _trip(self, e: Exception) -> None:
        """A runtime op failed mid-flight — drop the client and cool down."""
        logger.warning("Redis operation failed (%s); cooling down ~%.0fs.", e, _BREAKER_COOLDOWN)
        self._client = None
        self._down_until = time.monotonic() + _BREAKER_COOLDOWN

    def available(self) -> bool:
        """True if Redis is currently reachable. For health checks."""
        return self._client_or_none() is not None

    def ping(self) -> bool | None:
        """Round-trip to Redis now: True if it answered, False if it didn't, None
        when Redis isn't configured at all. For the readiness check."""
        if self._permanently_off:
            return None
        client = self._client_or_none()
        if client is None:
            return False
        try:
            return bool(client.ping())
        except Exception as e:  # noqa: BLE001
            self._trip(e)
            return False

    # ---- core operations ------------------------------------------------------

    def get_json(self, key: str) -> Any | None:
        """Return the cached JSON value for ``key``, or None on miss/error.

        Note: a stored JSON ``null`` is indistinguishable from a miss. Callers
        should not cache top-level ``None`` (use a sentinel/empty container)."""
        client = self._client_or_none()
        if client is None:
            return None
        try:
            raw = client.get(_KEY_PREFIX + key)
        except Exception as e:  # noqa: BLE001
            self._trip(e)
            return None
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            # Corrupt entry — drop it so the next read repopulates cleanly.
            self.delete(key)
            return None

    def set_json(self, key: str, value: Any, ttl: int) -> None:
        """Cache ``value`` (JSON-serialized) under ``key`` with a TTL in seconds."""
        client = self._client_or_none()
        if client is None:
            return
        try:
            client.set(_KEY_PREFIX + key, json.dumps(value, default=str), ex=ttl)
        except Exception as e:  # noqa: BLE001
            self._trip(e)

    def delete(self, *keys: str) -> None:
        """Invalidate one or more keys. No-op when Redis is unavailable."""
        client = self._client_or_none()
        if client is None or not keys:
            return
        try:
            client.delete(*[_KEY_PREFIX + k for k in keys])
        except Exception as e:  # noqa: BLE001
            self._trip(e)

    def incr(self, key: str, ttl: int) -> int | None:
        """Atomically increment a counter and (re)set its TTL. None when Redis is down.

        Used for security counters (e.g. login-failure tracking). Returns the new
        value so callers can compare against a threshold. The expire is refreshed
        on every call, which is the desired behaviour for a sliding failure window.
        """
        client = self._client_or_none()
        if client is None:
            return None
        try:
            pipe = client.pipeline()
            pipe.incr(_KEY_PREFIX + key)
            pipe.expire(_KEY_PREFIX + key, ttl)
            result = pipe.execute()
            return int(result[0])
        except Exception as e:  # noqa: BLE001
            self._trip(e)
            return None

    def set_int(self, key: str, value: int, ttl: int) -> None:
        """Set an integer key with a TTL. No-op when Redis is unavailable."""
        client = self._client_or_none()
        if client is None:
            return
        try:
            client.set(_KEY_PREFIX + key, int(value), ex=ttl)
        except Exception as e:  # noqa: BLE001
            self._trip(e)

    def get_int(self, key: str) -> int | None:
        """Read an integer key, or None on miss / non-integer value / Redis down."""
        client = self._client_or_none()
        if client is None:
            return None
        try:
            raw = client.get(_KEY_PREFIX + key)
        except Exception as e:  # noqa: BLE001
            self._trip(e)
            return None
        if raw is None:
            return None
        try:
            return int(raw)
        except (ValueError, TypeError):
            return None

    def ttl(self, key: str) -> int:
        """Remaining time-to-live for ``key`` in seconds.

        Returns 0 when the key is missing, has no expiry, or Redis is unavailable —
        so callers can treat any non-positive result uniformly as "not live".
        """
        client = self._client_or_none()
        if client is None:
            return 0
        try:
            remaining = client.ttl(_KEY_PREFIX + key)
        except Exception as e:  # noqa: BLE001
            self._trip(e)
            return 0
        # redis-py returns -2 (missing) or -1 (no expiry) as sentinels.
        return remaining if remaining and remaining > 0 else 0

    def exists(self, key: str) -> bool:
        """True if the key is present. False on miss or when Redis is unavailable."""
        client = self._client_or_none()
        if client is None:
            return False
        try:
            return bool(client.exists(_KEY_PREFIX + key))
        except Exception as e:  # noqa: BLE001
            self._trip(e)
            return False

    def get_or_set(self, key: str, ttl: int, loader: Callable[[], Any]) -> Any:
        """Read-through cache-aside helper.

        Returns the cached value if present; otherwise calls ``loader()``, caches
        the result (unless it's None), and returns it. ``loader`` always runs on a
        cache miss *or* when Redis is down, so correctness never depends on Redis.
        """
        cached = self.get_json(key)
        if cached is not None:
            return cached
        value = loader()
        if value is not None:
            self.set_json(key, value, ttl)
        return value


# Module-level singleton — import this everywhere.
cache = _Cache()
