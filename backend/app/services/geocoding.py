"""GeocodingClient — hardened wrapper around the Open-Meteo Geocoding API.

Extracted from app/api/locations.py (Phase 3). The security posture is preserved
verbatim: HTTPS-only, hardcoded upstream host, strict query validation, per-user
in-process rate limiting, and defensive re-shaping of upstream fields (no HTML
ever proxied). The rate-limit bucket is class-level so it's shared process-wide.
"""
from __future__ import annotations

import re
import time
import uuid
from collections import deque
from typing import Any

import httpx

from ..core.exceptions import AppException, BadRequestError


class _UpstreamError(AppException):
    """Maps geocoding upstream failures to HTTP 502."""

    status_code = 502
    code = "geocoding_upstream"


class _RateLimitedError(AppException):
    status_code = 429
    code = "rate_limited"


class GeocodingClient:
    """Proxy to Open-Meteo's geocoding search. One instance per request is fine;
    rate-limit state is shared on the class."""

    UPSTREAM = "https://geocoding-api.open-meteo.com/v1/search"

    # Allow only the characters a real place name can contain. Rejects HTML,
    # JSON, URLs, control chars — anything an attacker would inject.
    _QUERY_RE = re.compile(r"^[\w\s,.'\-]{2,80}$", re.UNICODE)

    _RATE_WINDOW_S = 60
    _RATE_MAX = 60
    _RATE: dict[str, deque[float]] = {}

    def search(self, q: str, user_id: uuid.UUID) -> list[dict[str, Any]]:
        self._rate_limit(user_id)
        cleaned = self._validate_query(q)

        params: dict[str, Any] = {"name": cleaned, "count": 10, "language": "en", "format": "json"}
        try:
            with httpx.Client(timeout=6.0) as client:
                r = client.get(self.UPSTREAM, params=params)
        except httpx.HTTPError as e:
            raise _UpstreamError(f"Geocoding request failed: {e}")
        if r.status_code >= 400:
            raise _UpstreamError(f"Geocoding returned {r.status_code}")

        results = (r.json().get("results")) or []
        out: list[dict[str, Any]] = []
        for row in results[:10]:
            lat = row.get("latitude")
            lon = row.get("longitude")
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            name = self._clean(row.get("name"))
            country = self._clean(row.get("country"))
            region = self._clean(row.get("admin1"))
            parts = [p for p in (name, region, country) if p]
            label = ", ".join(parts) if parts else "Unknown place"
            out.append({
                "label": label[:120],
                "lat": float(lat),
                "lon": float(lon),
                "country": country,
                "region": region,
            })
        return out

    # ── internals (verbatim security logic) ───────────────────────────────────

    @classmethod
    def _validate_query(cls, q: str) -> str:
        q = (q or "").strip()
        if not cls._QUERY_RE.fullmatch(q):
            raise BadRequestError(
                "Search must be 2–80 chars and only contain letters, numbers, spaces, "
                "commas, apostrophes, periods, or hyphens."
            )
        return q

    @classmethod
    def _rate_limit(cls, user_id: uuid.UUID) -> None:
        """Allow at most 60 search requests per 60 seconds per user."""
        key = str(user_id)
        now = time.time()
        bucket = cls._RATE.get(key)
        if bucket is None:
            bucket = deque()
            cls._RATE[key] = bucket
        while bucket and bucket[0] <= now - cls._RATE_WINDOW_S:
            bucket.popleft()
        if len(bucket) >= cls._RATE_MAX:
            raise _RateLimitedError("Too many searches — slow down and try again in a minute.")
        bucket.append(now)

    @staticmethod
    def _clean(s: Any, n: int = 120) -> str | None:
        if not isinstance(s, str):
            return None
        return re.sub(r"[<>\x00-\x1f\x7f]", "", s)[:n].strip() or None
