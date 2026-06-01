"""Weather proxy — Google Weather API primary, Open-Meteo fallback.

The frontend never talks to the upstream provider directly: this endpoint
hides the API key, resolves the requesting client's location from their IP
address (no browser-geolocation prompt), normalises both weather providers
into one schema, and caches responses so we don't burn quota when every tab
re-mounts the same widget.

Output schema:
{
  "provider": "google" | "open-meteo",
  "temp_c": float,
  "feels_like_c": float | null,
  "humidity_pct": int | null,
  "wind_kph": float | null,
  "condition": str,            # human-readable, e.g. "Partly cloudy"
  "condition_code": str,       # short slug we can map to an icon, e.g. "partly_cloudy"
  "is_daytime": bool,
  "location": { "lat": float, "lon": float, "label": str | None },
  "fetched_at": str,           # ISO-8601 UTC
}
"""
from __future__ import annotations

import ipaddress
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..core.config import settings
from ..core.security import get_current_user

router = APIRouter()

# Cache: { (lat_r, lon_r): (expires_at_epoch, payload) }
# Coords are rounded to 2 decimals (~1.1 km) so users in the same neighbourhood
# share a cache entry. 10-minute TTL — weather doesn't move that fast.
_CACHE: dict[tuple[float, float], tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 10 * 60


# Google Weather API condition types → our normalised slugs.
# Reference: https://developers.google.com/maps/documentation/weather/overview
_GOOGLE_COND_MAP: dict[str, tuple[str, str]] = {
    "CLEAR": ("clear", "Clear"),
    "MOSTLY_CLEAR": ("mostly_clear", "Mostly clear"),
    "PARTLY_CLOUDY": ("partly_cloudy", "Partly cloudy"),
    "MOSTLY_CLOUDY": ("mostly_cloudy", "Mostly cloudy"),
    "CLOUDY": ("cloudy", "Cloudy"),
    "WINDY": ("windy", "Windy"),
    "WIND_AND_RAIN": ("wind_rain", "Windy & rainy"),
    "LIGHT_RAIN_SHOWERS": ("rain_light", "Light showers"),
    "CHANCE_OF_SHOWERS": ("rain_chance", "Chance of showers"),
    "SCATTERED_SHOWERS": ("rain_scattered", "Scattered showers"),
    "RAIN_SHOWERS": ("rain", "Rain showers"),
    "HEAVY_RAIN_SHOWERS": ("rain_heavy", "Heavy showers"),
    "LIGHT_TO_MODERATE_RAIN": ("rain_light", "Light to moderate rain"),
    "MODERATE_TO_HEAVY_RAIN": ("rain_heavy", "Moderate to heavy rain"),
    "RAIN": ("rain", "Rain"),
    "LIGHT_RAIN": ("rain_light", "Light rain"),
    "HEAVY_RAIN": ("rain_heavy", "Heavy rain"),
    "RAIN_PERIODICALLY_HEAVY": ("rain_heavy", "Rain, periodically heavy"),
    "LIGHT_SNOW_SHOWERS": ("snow_light", "Light snow"),
    "CHANCE_OF_SNOW_SHOWERS": ("snow_chance", "Chance of snow"),
    "SCATTERED_SNOW_SHOWERS": ("snow", "Scattered snow"),
    "SNOW_SHOWERS": ("snow", "Snow"),
    "HEAVY_SNOW_SHOWERS": ("snow_heavy", "Heavy snow"),
    "LIGHT_TO_MODERATE_SNOW": ("snow", "Light to moderate snow"),
    "MODERATE_TO_HEAVY_SNOW": ("snow_heavy", "Moderate to heavy snow"),
    "SNOW": ("snow", "Snow"),
    "LIGHT_SNOW": ("snow_light", "Light snow"),
    "HEAVY_SNOW": ("snow_heavy", "Heavy snow"),
    "SNOWSTORM": ("snow_heavy", "Snowstorm"),
    "SNOW_PERIODICALLY_HEAVY": ("snow_heavy", "Snow, periodically heavy"),
    "HEAVY_SNOW_STORM": ("snow_heavy", "Heavy snowstorm"),
    "BLOWING_SNOW": ("snow", "Blowing snow"),
    "RAIN_AND_SNOW": ("sleet", "Rain & snow"),
    "HAIL": ("hail", "Hail"),
    "HAIL_SHOWERS": ("hail", "Hail showers"),
    "THUNDERSTORM": ("thunderstorm", "Thunderstorm"),
    "THUNDERSHOWER": ("thunderstorm", "Thundershowers"),
    "LIGHT_THUNDERSTORM_RAIN": ("thunderstorm", "Light thunderstorm rain"),
    "SCATTERED_THUNDERSTORMS": ("thunderstorm", "Scattered thunderstorms"),
    "HEAVY_THUNDERSTORM": ("thunderstorm", "Heavy thunderstorm"),
}

# Open-Meteo WMO code → our normalised slugs.
# Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
_OPEN_METEO_COND_MAP: dict[int, tuple[str, str]] = {
    0:  ("clear", "Clear"),
    1:  ("mostly_clear", "Mostly clear"),
    2:  ("partly_cloudy", "Partly cloudy"),
    3:  ("cloudy", "Cloudy"),
    45: ("fog", "Fog"),
    48: ("fog", "Freezing fog"),
    51: ("rain_light", "Light drizzle"),
    53: ("rain_light", "Drizzle"),
    55: ("rain", "Heavy drizzle"),
    56: ("sleet", "Freezing drizzle"),
    57: ("sleet", "Heavy freezing drizzle"),
    61: ("rain_light", "Light rain"),
    63: ("rain", "Rain"),
    65: ("rain_heavy", "Heavy rain"),
    66: ("sleet", "Freezing rain"),
    67: ("sleet", "Heavy freezing rain"),
    71: ("snow_light", "Light snow"),
    73: ("snow", "Snow"),
    75: ("snow_heavy", "Heavy snow"),
    77: ("snow", "Snow grains"),
    80: ("rain_light", "Light showers"),
    81: ("rain", "Showers"),
    82: ("rain_heavy", "Violent showers"),
    85: ("snow", "Snow showers"),
    86: ("snow_heavy", "Heavy snow showers"),
    95: ("thunderstorm", "Thunderstorm"),
    96: ("thunderstorm", "Thunderstorm with hail"),
    99: ("thunderstorm", "Severe thunderstorm with hail"),
}


def _cache_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, 2), round(lon, 2))


def _cached(lat: float, lon: float) -> dict | None:
    key = _cache_key(lat, lon)
    hit = _CACHE.get(key)
    if not hit:
        return None
    expires, payload = hit
    if expires < time.time():
        _CACHE.pop(key, None)
        return None
    return payload


def _store(lat: float, lon: float, payload: dict) -> None:
    _CACHE[_cache_key(lat, lon)] = (time.time() + _CACHE_TTL_SECONDS, payload)


# IP-resolution cache: { ip_or_'self': (expires_at_epoch, lat, lon, label) }
# 1-hour TTL — public IPs change rarely, and ip-api.com's free tier rate-limits
# to ~45 req/min so caching is essential.
_IP_CACHE: dict[str, tuple[float, float, float, str | None]] = {}
_IP_CACHE_TTL_SECONDS = 60 * 60


def _extract_client_ip(request: Request) -> str | None:
    """Return the requesting client's public IP, preferring `X-Forwarded-For`
    when behind a proxy. Returns None when only a loopback/private address is
    visible (e.g. local dev) — caller falls back to a self-lookup."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # XFF can be a comma-separated chain — first entry is the original client.
        candidate = fwd.split(",")[0].strip()
        if candidate and _is_public_ip(candidate):
            return candidate
    real = request.headers.get("x-real-ip")
    if real and _is_public_ip(real.strip()):
        return real.strip()
    host = request.client.host if request.client else None
    if host and _is_public_ip(host):
        return host
    return None


def _is_public_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified)


def _resolve_ip_location(ip: str | None) -> tuple[float, float, str | None]:
    """Look up the (lat, lon, "City, Country") for an IP via ip-api.com.

    Passing `ip=None` makes ip-api resolve the *requesting server's* public IP
    — useful in local dev when the backend can't see the end-user's real IP.
    """
    cache_key = ip or "__self__"
    hit = _IP_CACHE.get(cache_key)
    now = time.time()
    if hit and hit[0] > now:
        return (hit[1], hit[2], hit[3])

    # ipapi.co — HTTPS-only free tier, no key required. We deliberately avoid
    # ip-api.com here because its free tier is HTTP-only (plaintext over the
    # wire). Hardcoded host, validated IP input.
    url = (
        f"https://ipapi.co/{ip}/json/" if ip else "https://ipapi.co/json/"
    )
    try:
        with httpx.Client(timeout=6.0, follow_redirects=False) as client:
            r = client.get(url, headers={"User-Agent": "RiceMill/1.0"})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"IP geolocation request failed: {e}")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"IP geolocation returned {r.status_code}")
    data = r.json()
    if data.get("error") or "latitude" not in data:
        raise HTTPException(
            status_code=502,
            detail=f"IP geolocation failed: {data.get('reason') or 'unknown'}",
        )
    lat = float(data["latitude"])
    lon = float(data["longitude"])
    city = data.get("city") or data.get("region") or None
    country = data.get("country_name") or None
    label = ", ".join(p for p in (city, country) if p) or None

    _IP_CACHE[cache_key] = (now + _IP_CACHE_TTL_SECONDS, lat, lon, label)
    return (lat, lon, label)


def _fetch_google(lat: float, lon: float) -> dict:
    """Google Weather API — currentConditions:lookup. Requires API key."""
    url = "https://weather.googleapis.com/v1/currentConditions:lookup"
    params = {
        "key": settings.GOOGLE_WEATHER_API_KEY,
        "location.latitude": lat,
        "location.longitude": lon,
        "unitsSystem": "METRIC",
    }
    with httpx.Client(timeout=8.0) as client:
        r = client.get(url, params=params)
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Google Weather API returned {r.status_code}: {r.text[:200]}",
        )
    data = r.json()
    cond_type = (data.get("weatherCondition") or {}).get("type") or "CLEAR"
    cond_code, cond_label = _GOOGLE_COND_MAP.get(cond_type, ("unknown", cond_type.replace("_", " ").title()))
    return {
        "provider": "google",
        "temp_c": (data.get("temperature") or {}).get("degrees"),
        "feels_like_c": (data.get("feelsLikeTemperature") or {}).get("degrees"),
        "humidity_pct": data.get("relativeHumidity"),
        "wind_kph": ((data.get("wind") or {}).get("speed") or {}).get("value"),
        "condition": cond_label,
        "condition_code": cond_code,
        "is_daytime": bool(data.get("isDaytime", True)),
        "location": {"lat": lat, "lon": lon, "label": None},
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def _fetch_open_meteo(lat: float, lon: float) -> dict:
    """Open-Meteo — free, no API key. Used as fallback when Google isn't configured."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
        "wind_speed_unit": "kmh",
        "temperature_unit": "celsius",
    }
    with httpx.Client(timeout=8.0) as client:
        r = client.get(url, params=params)
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Open-Meteo returned {r.status_code}: {r.text[:200]}",
        )
    data = r.json()
    cur = data.get("current") or {}
    code = int(cur.get("weather_code", 0))
    cond_code, cond_label = _OPEN_METEO_COND_MAP.get(code, ("unknown", "Unknown"))
    return {
        "provider": "open-meteo",
        "temp_c": cur.get("temperature_2m"),
        "feels_like_c": cur.get("apparent_temperature"),
        "humidity_pct": cur.get("relative_humidity_2m"),
        "wind_kph": cur.get("wind_speed_10m"),
        "condition": cond_label,
        "condition_code": cond_code,
        "is_daytime": bool(cur.get("is_day", 1)),
        "location": {"lat": lat, "lon": lon, "label": None},
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/weather")
def get_weather(
    request: Request,
    lat: float | None = Query(None, ge=-90.0, le=90.0, description="Optional latitude override"),
    lon: float | None = Query(None, ge=-180.0, le=180.0, description="Optional longitude override"),
    _user=Depends(get_current_user),
) -> dict[str, Any]:
    """Return normalised current weather for the client's location.

    Location resolution:
      1. If the caller passes explicit `lat` + `lon` query params, use them.
         (Useful for tests and for the admin overriding to a specific city.)
      2. Otherwise, geolocate via the requesting client's public IP using
         ip-api.com. If the request comes from a private/loopback address
         (typical for `localhost` dev), fall back to the *server's* public IP.

    Weather provider: Google Weather when `GOOGLE_WEATHER_API_KEY` is set,
    Open-Meteo otherwise (no key required). Responses are cached for 10
    minutes per (lat, lon) rounded to 2 decimals; IP→coords lookups are
    cached for one hour.
    """
    label: str | None = None
    if lat is not None and lon is not None:
        coords = (lat, lon)
    else:
        client_ip = _extract_client_ip(request)
        coords_lat, coords_lon, label = _resolve_ip_location(client_ip)
        coords = (coords_lat, coords_lon)
    lat, lon = coords

    cached = _cached(lat, lon)
    if cached is not None:
        # Replace the location label with the freshly-resolved one so a user
        # whose IP changed gets the right city even if the temp is still cached.
        if label is not None:
            cached = {**cached, "location": {**cached["location"], "label": label}}
        return cached

    if settings.GOOGLE_WEATHER_API_KEY:
        try:
            payload = _fetch_google(lat, lon)
        except HTTPException:
            # If Google fails (quota / network), fall through to Open-Meteo so
            # the user never sees a dead widget when a free option exists.
            payload = _fetch_open_meteo(lat, lon)
    else:
        payload = _fetch_open_meteo(lat, lon)

    if label is not None:
        payload["location"]["label"] = label
    _store(lat, lon, payload)
    return payload
