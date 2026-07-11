"""Characterization: the Enterprise-only Drying Advisor endpoint.

The forecast fetch and the DeepSeek call are both external network calls, so
every test here stubs WeatherService.get_forecast and httpx.Client.post rather
than reaching the internet. This pins the security-relevant contract: feature
gating, "not configured" behavior, response validation against untrusted model
output, and the location/day cache.
"""
from __future__ import annotations

import json

import pytest
from pydantic import SecretStr

import app.core.config as cfg
from app.core.ratelimit import limiter
from app.services.weather import WeatherService

FAKE_FORECAST = {
    "provider": "open-meteo",
    "location": {"lat": 14.6, "lon": 120.98, "label": "Manila, Philippines"},
    "daily": [
        {"date": "2026-07-12", "condition": "Partly cloudy", "precip_pct": 10,
         "temp_max_c": 32.0, "temp_min_c": 24.0},
    ],
    "hourly": [
        {"time": "2026-07-12T09:00", "condition": "Clear", "precip_pct": 5,
         "temp_c": 28.0, "is_daytime": True},
    ],
    "fetched_at": "2026-07-12T00:00:00+00:00",
}


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def _deepseek_content(**overrides) -> str:
    body = {
        "verdict": "good",
        "headline": "Good drying day today",
        "reasoning": "Clear skies expected with low rain chance through the afternoon.",
        "best_window": "Today, 9am-3pm",
        **overrides,
    }
    return json.dumps(body)


@pytest.fixture(autouse=True)
def stub_forecast(monkeypatch):
    """No test in this file should ever reach Open-Meteo or ipapi.co."""
    monkeypatch.setattr(WeatherService, "get_forecast", lambda self, request, lat, lon: FAKE_FORECAST)


@pytest.fixture
def deepseek_key(monkeypatch):
    monkeypatch.setattr(cfg.settings, "DEEPSEEK_API_KEY", SecretStr("fake-key"), raising=False)


@pytest.fixture
def fake_cache(monkeypatch):
    """The test suite runs with REDIS_URL="" (conftest), so the real cache
    singleton is permanently a no-op — every read is a miss. Swap in a small
    in-process dict so the caching *logic* (key shape, the cached=True flip on
    a hit) is actually exercised instead of trivially "always recomputes"."""
    from app.core.cache import cache as cache_singleton

    store: dict[str, object] = {}
    monkeypatch.setattr(cache_singleton, "get_json", lambda key: store.get(key))
    monkeypatch.setattr(cache_singleton, "set_json", lambda key, value, ttl: store.__setitem__(key, value))
    return store


def _mock_deepseek(monkeypatch, *, status_code=200, content=None, calls=None):
    """Patch httpx.Client.post. ``calls`` (a list) records each invocation."""
    if content is None:
        content = _deepseek_content()
    payload = {"choices": [{"message": {"content": content}}]}

    def _post(self, url, headers=None, json=None, **kwargs):
        if calls is not None:
            calls.append(url)
        return _FakeResponse(status_code, payload)

    monkeypatch.setattr("httpx.Client.post", _post)


def test_route_accepts_response_headers_with_rate_limiting_enabled(make_auth_client, deepseek_key, monkeypatch):
    """The suite runs with RATE_LIMIT_ENABLED=false (conftest), so slowapi's
    header-injection path — which requires the route to declare a `response:
    Response` parameter — never actually runs in any other test here. Flip the
    limiter on for real and confirm the route still returns 200 rather than
    500ing inside slowapi's `_inject_headers` (regression: this endpoint
    originally omitted `response: Response`, which only this test catches)."""
    monkeypatch.setattr(limiter, "enabled", True)
    _mock_deepseek(monkeypatch)
    c = make_auth_client(features=["drying_advisor"], username="ratelimited")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 200, res.text
    assert "X-RateLimit-Limit" in res.headers


def test_requires_drying_advisor_feature(make_auth_client):
    # Owner role has full dashboard access, but this plan lacks the feature.
    c = make_auth_client(features=["dashboard"], username="noplan")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 402


def test_not_configured_without_api_key(make_auth_client, monkeypatch):
    monkeypatch.setattr(cfg.settings, "DEEPSEEK_API_KEY", None, raising=False)
    c = make_auth_client(features=["drying_advisor"], username="noapikey")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 501


def test_successful_advisory_matches_schema(make_auth_client, deepseek_key, monkeypatch):
    _mock_deepseek(monkeypatch)
    c = make_auth_client(features=["drying_advisor"], username="entitled")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["verdict"] == "good"
    assert body["headline"] == "Good drying day today"
    assert body["best_window"] == "Today, 9am-3pm"
    assert body["location"] == {"lat": 14.6, "lon": 120.98, "label": "Manila, Philippines"}
    assert body["cached"] is False


def test_second_call_same_day_is_served_from_cache(make_auth_client, deepseek_key, fake_cache, monkeypatch):
    calls: list[str] = []
    _mock_deepseek(monkeypatch, calls=calls)
    c = make_auth_client(features=["drying_advisor"], username="cached")

    first = c.get("/api/drying-advisory")
    second = c.get("/api/drying-advisory")

    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["cached"] is False
    assert second.json()["cached"] is True
    assert len(calls) == 1  # DeepSeek was only ever asked once


def test_upstream_non_2xx_returns_502(make_auth_client, deepseek_key, monkeypatch):
    _mock_deepseek(monkeypatch, status_code=500)
    c = make_auth_client(features=["drying_advisor"], username="upstream500")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 502


def test_malformed_json_content_returns_502(make_auth_client, deepseek_key, monkeypatch):
    _mock_deepseek(monkeypatch, content="not valid json")
    c = make_auth_client(features=["drying_advisor"], username="malformed")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 502


def test_invalid_verdict_returns_502(make_auth_client, deepseek_key, monkeypatch):
    _mock_deepseek(monkeypatch, content=_deepseek_content(verdict="excellent"))
    c = make_auth_client(features=["drying_advisor"], username="badverdict")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 502


def test_model_cannot_spoof_location_or_extra_fields(make_auth_client, deepseek_key, monkeypatch):
    """A model response that includes location/generated_at/cached (fields the
    caller controls) must not crash the request and must not override the real
    values — see the explicit allowlist in DryingAdvisorService._ask_deepseek."""
    spoofed = _deepseek_content(location={"lat": 0.0, "lon": 0.0, "label": "nowhere"})
    _mock_deepseek(monkeypatch, content=spoofed)
    c = make_auth_client(features=["drying_advisor"], username="spoofer")
    res = c.get("/api/drying-advisory")
    assert res.status_code == 200, res.text
    assert res.json()["location"] == {"lat": 14.6, "lon": 120.98, "label": "Manila, Philippines"}
