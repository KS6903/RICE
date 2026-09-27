"""Unit tests: DryingAdvisory strictly validates whatever the model returns."""

import pytest
from pydantic import ValidationError

from app.schemas.drying_advisor import DryingAdvisory

VALID = dict(
    verdict="good",
    headline="Good drying day today",
    reasoning="Clear skies and low rain chance through the afternoon.",
    best_window="Today, 9am-3pm",
    generated_at="2026-07-12T00:00:00+00:00",
    location={"lat": 14.6, "lon": 120.98, "label": "Manila, Philippines"},
)


def test_valid_payload_round_trips():
    advisory = DryingAdvisory(**VALID)
    assert advisory.verdict == "good"
    assert advisory.cached is False


def test_best_window_is_optional():
    advisory = DryingAdvisory(**{**VALID, "best_window": None})
    assert advisory.best_window is None


def test_unknown_verdict_rejected():
    with pytest.raises(ValidationError):
        DryingAdvisory(**{**VALID, "verdict": "excellent"})


def test_oversized_headline_rejected():
    with pytest.raises(ValidationError):
        DryingAdvisory(**{**VALID, "headline": "x" * 81})


def test_oversized_reasoning_rejected():
    with pytest.raises(ValidationError):
        DryingAdvisory(**{**VALID, "reasoning": "x" * 281})


def test_empty_headline_rejected():
    with pytest.raises(ValidationError):
        DryingAdvisory(**{**VALID, "headline": ""})


def test_unknown_extra_field_rejected():
    """extra='forbid': a field the model wasn't asked for must fail validation,
    not silently pass through to a client."""
    with pytest.raises(ValidationError):
        DryingAdvisory(**VALID, unexpected="surprise")
