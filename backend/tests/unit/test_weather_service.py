"""Unit tests for WeatherService pure helpers (Phase 3 — no network)."""
from app.services.weather import WeatherService


def test_cache_key_rounds_to_2dp():
    assert WeatherService._cache_key(14.5991, 120.9842) == (14.6, 120.98)


def test_is_public_ip():
    assert WeatherService._is_public_ip("8.8.8.8") is True
    assert WeatherService._is_public_ip("127.0.0.1") is False
    assert WeatherService._is_public_ip("192.168.1.10") is False
    assert WeatherService._is_public_ip("not-an-ip") is False


def test_store_then_cached_roundtrip():
    svc = WeatherService()
    payload = {"provider": "open-meteo", "location": {"lat": 1.0, "lon": 2.0, "label": None}}
    svc._store(1.23456, 2.34567, payload)
    assert svc._cached(1.23456, 2.34567) == payload


def test_condition_maps_have_expected_entries():
    assert WeatherService._OPEN_METEO_COND_MAP[0] == ("clear", "Clear")
    assert WeatherService._OPEN_METEO_COND_MAP[95][0] == "thunderstorm"
    assert WeatherService._GOOGLE_COND_MAP["PARTLY_CLOUDY"] == ("partly_cloudy", "Partly cloudy")
