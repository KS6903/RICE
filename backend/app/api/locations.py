"""User-saved weather locations + a hardened geocoding search proxy.

Security posture (the user explicitly asked for this — "no sniffing, no phishing"):
  - All upstream calls use HTTPS (Open-Meteo Geocoding API).
  - Upstream URL is hardcoded; the user's query is only ever a `name=` parameter
    on a fixed host. No URL-from-input, so SSRF / open-redirect surface is nil.
  - Search queries are validated: max 80 chars, only letters / digits / spaces /
    commas / apostrophes / periods / hyphens (no scheme characters, no angle
    brackets, no scripts).
  - Labels are stored as plain text only; the frontend renders them through
    React (HTML-escaped). We never proxy upstream HTML.
  - Every endpoint requires auth (`get_current_user`), so an unauthenticated
    attacker can't burn the upstream's rate budget.
  - Per-user, in-process rate limit on the geocoding search: 60 calls/min.
  - We never log the user's saved coords, the query string, or the resolved IP.
"""
from __future__ import annotations

import re
import time
import uuid
from collections import deque
from decimal import Decimal
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user_location import UserLocation

router = APIRouter()


# ── Search input validation ──────────────────────────────────────────────────

# Allow only the characters a real place name can contain. Rejects HTML, JSON,
# URLs, control chars, etc. — anything an attacker would inject.
_QUERY_RE = re.compile(r"^[\w\s,.'\-]{2,80}$", re.UNICODE)


def _validate_query(q: str) -> str:
    q = (q or "").strip()
    if not _QUERY_RE.fullmatch(q):
        raise HTTPException(
            status_code=400,
            detail="Search must be 2–80 chars and only contain letters, numbers, spaces, commas, apostrophes, periods, or hyphens.",
        )
    return q


# ── Per-user rate limiter (in-process, best-effort) ──────────────────────────

_RATE_WINDOW_S = 60
_RATE_MAX = 60
_RATE: dict[str, deque[float]] = {}


def _rate_limit(user_id: uuid.UUID) -> None:
    """Allow at most 60 search requests per 60 seconds per user."""
    key = str(user_id)
    now = time.time()
    bucket = _RATE.get(key)
    if bucket is None:
        bucket = deque()
        _RATE[key] = bucket
    while bucket and bucket[0] <= now - _RATE_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= _RATE_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many searches — slow down and try again in a minute.",
        )
    bucket.append(now)


# ── Serialization ────────────────────────────────────────────────────────────

def _serialize(loc: UserLocation) -> dict[str, Any]:
    return {
        "id": str(loc.id),
        "label": loc.label,
        "lat": float(loc.lat),
        "lon": float(loc.lon),
        "country": loc.country,
        "region": loc.region,
        "is_default": loc.is_default,
        "created_at": loc.created_at.isoformat() if loc.created_at else None,
    }


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class LocationCreate(BaseModel):
    label: str = Field(..., min_length=2, max_length=120)
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    country: str | None = Field(default=None, max_length=80)
    region: str | None = Field(default=None, max_length=120)
    is_default: bool = False

    @field_validator("label", "country", "region")
    @classmethod
    def _strip_html(cls, v: str | None) -> str | None:
        if v is None:
            return None
        # Aggressively strip anything that could be HTML / control chars.
        clean = re.sub(r"[<>\x00-\x1f\x7f]", "", v).strip()
        return clean or None


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/locations")
def list_locations(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(UserLocation)
        .filter(UserLocation.user_id == current_user.id)
        .order_by(UserLocation.is_default.desc(), UserLocation.created_at.asc())
        .all()
    )
    return [_serialize(r) for r in rows]


@router.post("/locations", status_code=status.HTTP_201_CREATED)
def create_location(
    body: LocationCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    label = body.label.strip()
    # Dedupe on (user_id, label) — return the existing row instead of 409 so the
    # UI can re-add a search result without an error path.
    existing = (
        db.query(UserLocation)
        .filter(UserLocation.user_id == current_user.id, UserLocation.label == label)
        .first()
    )
    if existing:
        return _serialize(existing)

    # First location auto-becomes the default so the widget has something to
    # show on next login.
    has_any = (
        db.query(UserLocation).filter(UserLocation.user_id == current_user.id).first()
        is not None
    )
    should_default = body.is_default or not has_any
    if should_default:
        # Clear any prior default before flipping ours on.
        db.query(UserLocation).filter(
            UserLocation.user_id == current_user.id, UserLocation.is_default == True  # noqa: E712
        ).update({UserLocation.is_default: False})

    loc = UserLocation(
        user_id=current_user.id,
        label=label,
        lat=Decimal(str(round(body.lat, 4))),
        lon=Decimal(str(round(body.lon, 4))),
        country=body.country,
        region=body.region,
        is_default=should_default,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return _serialize(loc)


@router.patch("/locations/{location_id}/set-default")
def set_default(
    location_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    loc = db.get(UserLocation, location_id)
    if not loc or loc.user_id != current_user.id:
        raise HTTPException(404, "Location not found")
    db.query(UserLocation).filter(
        UserLocation.user_id == current_user.id, UserLocation.id != loc.id
    ).update({UserLocation.is_default: False})
    loc.is_default = True
    db.commit()
    db.refresh(loc)
    return _serialize(loc)


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(
    location_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    loc = db.get(UserLocation, location_id)
    if not loc or loc.user_id != current_user.id:
        raise HTTPException(404, "Location not found")
    was_default = loc.is_default
    db.delete(loc)
    db.flush()
    if was_default:
        # Promote the next-oldest location to default so the widget keeps working.
        sibling = (
            db.query(UserLocation)
            .filter(UserLocation.user_id == current_user.id)
            .order_by(UserLocation.created_at.asc())
            .first()
        )
        if sibling:
            sibling.is_default = True
    db.commit()


# ── Geocoding search proxy ───────────────────────────────────────────────────

@router.get("/locations/search")
def search_places(
    q: str = Query(..., min_length=2, max_length=80, description="Place name"),
    current_user=Depends(get_current_user),
):
    """Hardened proxy to the Open-Meteo Geocoding API.

    Returns a list of candidate places — the UI shows them in the picker and
    POSTs the chosen one back to /api/locations to save.
    """
    _rate_limit(current_user.id)
    cleaned = _validate_query(q)

    upstream = "https://geocoding-api.open-meteo.com/v1/search"
    params = {"name": cleaned, "count": 10, "language": "en", "format": "json"}
    try:
        with httpx.Client(timeout=6.0) as client:
            r = client.get(upstream, params=params)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Geocoding request failed: {e}")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Geocoding returned {r.status_code}")

    data = r.json()
    results = data.get("results") or []
    # Re-shape into our own schema. We DO NOT pass upstream fields untouched —
    # anything that could carry HTML (admin1/2/3 names) is plain-text only when
    # rendered, but we still clip them defensively.
    def clean(s: Any, n: int = 120) -> str | None:
        if not isinstance(s, str):
            return None
        return re.sub(r"[<>\x00-\x1f\x7f]", "", s)[:n].strip() or None

    out = []
    for row in results[:10]:
        lat = row.get("latitude")
        lon = row.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        name = clean(row.get("name"))
        country = clean(row.get("country"))
        region = clean(row.get("admin1"))
        # Compose a readable label: "Manila, Metro Manila, Philippines"
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
