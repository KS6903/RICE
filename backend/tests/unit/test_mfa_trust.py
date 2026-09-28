"""The weekly 2FA re-prompt falls on Sunday 00:00 in the user's own local time."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.mfa_trust import local_zone, next_reset_at

MANILA = ZoneInfo("Asia/Manila")
NEW_YORK = ZoneInfo("America/New_York")
LONDON = ZoneInfo("Europe/London")


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def test_resets_at_the_coming_sunday_midnight_local():
    # Wednesday 30 Sep 2026, 15:00 in Manila → Sunday 4 Oct 00:00 in Manila.
    assert next_reset_at(MANILA, _at("2026-09-30T15:00+08:00")) == _at("2026-10-04T00:00+08:00")


def test_a_sunday_verify_lasts_until_the_following_sunday():
    # Sunday 27 Sep 2026, 09:00 in Manila → Sunday 4 Oct, not later the same day.
    assert next_reset_at(MANILA, _at("2026-09-27T09:00+08:00")) == _at("2026-10-04T00:00+08:00")


def test_each_user_resets_on_their_own_sunday():
    # 20:00 UTC on Saturday 3 Oct 2026 is already Sunday 04:00 in Manila but
    # still Saturday 16:00 in New York.
    now = _at("2026-10-03T20:00+00:00")
    assert next_reset_at(MANILA, now) == _at("2026-10-11T00:00+08:00")
    assert next_reset_at(NEW_YORK, now) == _at("2026-10-04T00:00-04:00")


def test_follows_daylight_saving():
    # London is on BST (+01:00) until 02:00 on Sunday 25 Oct 2026, then GMT.
    assert next_reset_at(LONDON, _at("2026-10-21T12:00+01:00")) == _at("2026-10-25T00:00+01:00")
    assert next_reset_at(LONDON, _at("2026-10-26T12:00+00:00")) == _at("2026-11-01T00:00+00:00")


def test_no_zone_stretches_trust_past_a_week():
    # The browser picks the zone, so any zone must still expire within 7 days.
    now = _at("2026-09-30T12:00+00:00")
    for name in ("Pacific/Kiritimati", "Etc/GMT+12", "Asia/Manila", "America/New_York"):
        assert timedelta(0) < next_reset_at(ZoneInfo(name), now) - now <= timedelta(days=7)


def test_zone_prefers_the_browser_then_the_company_then_manila():
    assert local_zone("America/New_York", "Asia/Manila").key == "America/New_York"
    assert local_zone(None, "Europe/London").key == "Europe/London"
    assert local_zone("Not/AZone", "Europe/London").key == "Europe/London"
    assert local_zone("../../etc/passwd", None).key == "Asia/Manila"
    assert local_zone("", "").key == "Asia/Manila"
