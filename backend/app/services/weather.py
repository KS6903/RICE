"""WeatherService — normalized weather proxy (Phase 3).

Extracted from app/api/weather.py into a class. No database: this wraps two
upstream providers (Google Weather primary, Open-Meteo fallback) plus IP
geolocation, hides the API key, normalizes both providers into one schema, and
caches responses (Redis-shared + per-process in-memory). All upstream/security
behavior is preserved verbatim. 502s on upstream failure are raised as
HTTPException since this is an HTTP proxy with no DB transaction to own.
"""

from __future__ import annotations

import ipaddress
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException, Request

from ..core.cache import TTL_IP_GEO, TTL_WEATHER, TTL_WEATHER_FORECAST, cache
from ..core.config import settings


class WeatherService:
    # Google Weather API condition types → our normalized slugs.
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

    # Open-Meteo WMO code → our normalized slugs.
    _OPEN_METEO_COND_MAP: dict[int, tuple[str, str]] = {
        0: ("clear", "Clear"),
        1: ("mostly_clear", "Mostly clear"),
        2: ("partly_cloudy", "Partly cloudy"),
        3: ("cloudy", "Cloudy"),
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

    _CACHE: dict[tuple[float, float], tuple[float, dict]] = {}
    _CACHE_TTL_SECONDS = 10 * 60
    _IP_CACHE: dict[str, tuple[float, float, float, str | None]] = {}
    _IP_CACHE_TTL_SECONDS = 60 * 60

    # ── public ────────────────────────────────────────────────────────────────

    def get_weather(self, request: Request, lat: float | None, lon: float | None) -> dict[str, Any]:
        label: str | None = None
        if lat is not None and lon is not None:
            coords = (lat, lon)
        else:
            client_ip = self._extract_client_ip(request)
            coords_lat, coords_lon, label = self._resolve_ip_location(client_ip)
            coords = (coords_lat, coords_lon)
        lat, lon = coords

        cached = self._cached(lat, lon)
        if cached is not None:
            if label is not None:
                cached = {**cached, "location": {**cached["location"], "label": label}}
            return cached

        if settings.GOOGLE_WEATHER_API_KEY:
            try:
                payload = self._fetch_google(lat, lon)
            except HTTPException:
                payload = self._fetch_open_meteo(lat, lon)
        else:
            payload = self._fetch_open_meteo(lat, lon)

        if label is not None:
            payload["location"]["label"] = label
        self._store(lat, lon, payload)
        return payload

    def get_forecast(self, request: Request, lat: float | None, lon: float | None) -> dict[str, Any]:
        """Hourly (next 24h) + daily (7-day) forecast for the client's location.

        Always sourced from Open-Meteo (free, no key, and the one upstream that
        serves hourly+daily in a single call) regardless of which provider serves
        current conditions. Same IP-resolution + cache strategy as get_weather."""
        label: str | None = None
        if lat is not None and lon is not None:
            lat, lon = lat, lon
        else:
            client_ip = self._extract_client_ip(request)
            lat, lon, label = self._resolve_ip_location(client_ip)

        cached = cache.get_json(self._redis_forecast_key(lat, lon))
        if cached is not None:
            if label is not None:
                cached = {**cached, "location": {**cached["location"], "label": label}}
            return cached

        payload = self._fetch_open_meteo_forecast(lat, lon)
        if label is not None:
            payload["location"]["label"] = label
        cache.set_json(self._redis_forecast_key(lat, lon), payload, ttl=TTL_WEATHER_FORECAST)
        return payload

    # ── caching ───────────────────────────────────────────────────────────────

    @staticmethod
    def _cache_key(lat: float, lon: float) -> tuple[float, float]:
        return (round(lat, 2), round(lon, 2))

    @classmethod
    def _redis_weather_key(cls, lat: float, lon: float) -> str:
        r_lat, r_lon = cls._cache_key(lat, lon)
        return f"weather:{r_lat}:{r_lon}"

    @classmethod
    def _redis_forecast_key(cls, lat: float, lon: float) -> str:
        r_lat, r_lon = cls._cache_key(lat, lon)
        return f"weather:forecast:{r_lat}:{r_lon}"

    def _cached(self, lat: float, lon: float) -> dict | None:
        redis_hit = cache.get_json(self._redis_weather_key(lat, lon))
        if redis_hit is not None:
            return redis_hit
        key = self._cache_key(lat, lon)
        hit = self._CACHE.get(key)
        if not hit:
            return None
        expires, payload = hit
        if expires < time.time():
            self._CACHE.pop(key, None)
            return None
        return payload

    def _store(self, lat: float, lon: float, payload: dict) -> None:
        cache.set_json(self._redis_weather_key(lat, lon), payload, ttl=TTL_WEATHER)
        self._CACHE[self._cache_key(lat, lon)] = (time.time() + self._CACHE_TTL_SECONDS, payload)

    # ── IP geolocation ────────────────────────────────────────────────────────

    def _extract_client_ip(self, request: Request) -> str | None:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            candidate = fwd.split(",")[0].strip()
            if candidate and self._is_public_ip(candidate):
                return candidate
        real = request.headers.get("x-real-ip")
        if real and self._is_public_ip(real.strip()):
            return real.strip()
        host = request.client.host if request.client else None
        if host and self._is_public_ip(host):
            return host
        return None

    @staticmethod
    def _is_public_ip(value: str) -> bool:
        try:
            ip = ipaddress.ip_address(value)
        except ValueError:
            return False
        return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified)

    def _resolve_ip_location(self, ip: str | None) -> tuple[float, float, str | None]:
        cache_key = ip or "__self__"
        now = time.time()
        redis_key = f"weather:ipgeo:{cache_key}"
        redis_hit = cache.get_json(redis_key)
        if redis_hit is not None:
            return (redis_hit[0], redis_hit[1], redis_hit[2])
        hit = self._IP_CACHE.get(cache_key)
        if hit and hit[0] > now:
            return (hit[1], hit[2], hit[3])

        url = f"https://ipapi.co/{ip}/json/" if ip else "https://ipapi.co/json/"
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

        cache.set_json(redis_key, [lat, lon, label], ttl=TTL_IP_GEO)
        self._IP_CACHE[cache_key] = (now + self._IP_CACHE_TTL_SECONDS, lat, lon, label)
        return (lat, lon, label)

    # ── providers ─────────────────────────────────────────────────────────────

    def _fetch_google(self, lat: float, lon: float) -> dict:
        url = "https://weather.googleapis.com/v1/currentConditions:lookup"
        params: dict[str, Any] = {
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
        cond_code, cond_label = self._GOOGLE_COND_MAP.get(cond_type, ("unknown", cond_type.replace("_", " ").title()))
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

    def _fetch_open_meteo(self, lat: float, lon: float) -> dict:
        url = "https://api.open-meteo.com/v1/forecast"
        params: dict[str, Any] = {
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
        cond_code, cond_label = self._OPEN_METEO_COND_MAP.get(code, ("unknown", "Unknown"))
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

    def _fetch_open_meteo_forecast(self, lat: float, lon: float) -> dict:
        url = "https://api.open-meteo.com/v1/forecast"
        params: dict[str, Any] = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,weather_code,precipitation_probability,is_day",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": 7,
            "timezone": "auto",  # times come back in the location's local zone
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

        # ── Hourly: the next 24 hours starting at the location's current hour ──
        hourly_src = data.get("hourly") or {}
        times = hourly_src.get("time") or []
        temps = hourly_src.get("temperature_2m") or []
        codes = hourly_src.get("weather_code") or []
        precips = hourly_src.get("precipitation_probability") or []
        is_days = hourly_src.get("is_day") or []
        # Open-Meteo hourly entries start at local midnight today; pick the entry
        # for the current local hour so the strip begins "now", not at 00:00.
        offset = int(data.get("utc_offset_seconds", 0))
        local_now = datetime.now(timezone.utc).timestamp() + offset
        local_hour_start = local_now - (local_now % 3600)
        start = 0
        for i, t in enumerate(times):
            try:
                ts = datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                continue
            if ts >= local_hour_start:
                start = i
                break
        hourly: list[dict[str, Any]] = []
        for i in range(start, min(start + 24, len(times))):
            cond_code, cond_label = self._OPEN_METEO_COND_MAP.get(
                int(codes[i]) if i < len(codes) else 0, ("unknown", "Unknown")
            )
            hourly.append(
                {
                    "time": times[i],
                    "temp_c": temps[i] if i < len(temps) else None,
                    "condition": cond_label,
                    "condition_code": cond_code,
                    "precip_pct": precips[i] if i < len(precips) else None,
                    "is_daytime": bool(is_days[i]) if i < len(is_days) else True,
                }
            )

        # ── Daily: the 7-day outlook ──
        daily_src = data.get("daily") or {}
        d_dates = daily_src.get("time") or []
        d_codes = daily_src.get("weather_code") or []
        d_max = daily_src.get("temperature_2m_max") or []
        d_min = daily_src.get("temperature_2m_min") or []
        d_precip = daily_src.get("precipitation_probability_max") or []
        daily: list[dict[str, Any]] = []
        for i, day in enumerate(d_dates):
            cond_code, cond_label = self._OPEN_METEO_COND_MAP.get(
                int(d_codes[i]) if i < len(d_codes) else 0, ("unknown", "Unknown")
            )
            daily.append(
                {
                    "date": day,
                    "temp_max_c": d_max[i] if i < len(d_max) else None,
                    "temp_min_c": d_min[i] if i < len(d_min) else None,
                    "condition": cond_label,
                    "condition_code": cond_code,
                    "precip_pct": d_precip[i] if i < len(d_precip) else None,
                }
            )

        return {
            "provider": "open-meteo",
            "location": {"lat": lat, "lon": lon, "label": None},
            "hourly": hourly,
            "daily": daily,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
