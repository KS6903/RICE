"""Unit tests for DryingAdvisorService pure helpers (no network)."""

from app.services.drying_advisor_service import DryingAdvisorService, _language_rule

FORECAST = {
    "location": {"lat": 14.5995, "lon": 120.9842, "label": "Manila, Philippines"},
    "daily": [
        {"date": "2026-07-12", "condition": "Partly cloudy", "precip_pct": 10, "temp_max_c": 32.0, "temp_min_c": 24.0},
        {"date": "2026-07-13", "condition": "Rain", "precip_pct": 80, "temp_max_c": 29.0, "temp_min_c": 23.0},
    ],
    "hourly": [
        {"time": "2026-07-12T09:00", "condition": "Clear", "precip_pct": 5, "temp_c": 28.0, "is_daytime": True},
        {"time": "2026-07-12T21:00", "condition": "Clear", "precip_pct": 0, "temp_c": 24.0, "is_daytime": False},
    ],
}


def test_cache_key_rounds_coordinates():
    key = DryingAdvisorService._cache_key(14.59951, 120.98421, "2026-07-12")
    assert key == "drying-advisory:14.6:120.98:2026-07-12"


def test_each_language_has_its_own_answer():
    # English keeps the key it always had; another language gets its own.
    assert DryingAdvisorService._cache_key(14.6, 120.98, "2026-07-12", None).endswith("2026-07-12")
    assert DryingAdvisorService._cache_key(14.6, 120.98, "2026-07-12", "tl").endswith("2026-07-12:tl")


def test_the_prompt_asks_for_the_account_language():
    assert _language_rule(None) == ""
    rule = _language_rule("ceb")
    assert '"ceb"' in rule
    assert "Keep the JSON keys, and the verdict values, in English." in rule


def test_summarize_forecast_includes_location_and_today_marker():
    summary = DryingAdvisorService._summarize_forecast(FORECAST, "2026-07-12")
    assert "Manila, Philippines" in summary
    assert "2026-07-12 (today)" in summary
    assert "2026-07-13" in summary


def test_summarize_forecast_only_includes_daytime_hours():
    summary = DryingAdvisorService._summarize_forecast(FORECAST, "2026-07-12")
    assert "09:00" in summary
    assert "21:00" not in summary


def test_summarize_forecast_handles_missing_precip():
    forecast = {
        "location": {"lat": 1.0, "lon": 2.0, "label": None},
        "daily": [
            {"date": "2026-07-12", "condition": "Clear", "precip_pct": None, "temp_max_c": None, "temp_min_c": None}
        ],
        "hourly": [],
    }
    summary = DryingAdvisorService._summarize_forecast(forecast, "2026-07-12")
    assert "?% rain chance" in summary
    assert "1.00, 2.00" in summary  # no label -> falls back to coordinates
