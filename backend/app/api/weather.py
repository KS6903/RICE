"""Weather HTTP controller — thin routing over WeatherService (Phase 3).

The frontend never talks to the upstream provider directly: this endpoint hides
the API key, resolves the client's location from their IP, normalizes Google
Weather / Open-Meteo into one schema, and caches responses. All of that now
lives in WeatherService.
"""
from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from ..core.security import get_current_user
from ..services.weather import WeatherService

router = APIRouter()


def get_weather_service() -> WeatherService:
    return WeatherService()


@router.get("/weather")
def get_weather(
    request: Request,
    lat: float | None = Query(None, ge=-90.0, le=90.0, description="Optional latitude override"),
    lon: float | None = Query(None, ge=-180.0, le=180.0, description="Optional longitude override"),
    _user=Depends(get_current_user),
    svc: WeatherService = Depends(get_weather_service),
) -> dict[str, Any]:
    """Return normalized current weather for the client's location (IP-resolved
    unless explicit lat/lon are passed). Google Weather when configured, else
    Open-Meteo; cached 10 min per ~1km cell."""
    return svc.get_weather(request, lat, lon)
