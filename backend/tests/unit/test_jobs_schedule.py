"""Schedules decide when a job is due and name each run."""

from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.jobs.schedule import daily, hourly, tenant_zone

MANILA = ZoneInfo("Asia/Manila")


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def test_daily_is_due_from_its_local_time_and_named_by_local_date():
    at_three = daily(time(3, 0))
    assert at_three(_at("2026-09-27T02:59+08:00"), MANILA) is None
    assert at_three(_at("2026-09-27T03:00+08:00"), MANILA) == "2026-09-27"
    assert at_three(_at("2026-09-27T23:59+08:00"), MANILA) == "2026-09-27"


def test_daily_uses_the_tenant_date_not_the_utc_date():
    # 19:30 UTC on the 26th is 03:30 in Manila on the 27th.
    assert daily(time(3, 0))(_at("2026-09-26T19:30+00:00"), MANILA) == "2026-09-27"


def test_daily_follows_daylight_saving_in_zones_that_have_it():
    new_york = ZoneInfo("America/New_York")
    # 2026-03-08 is the US spring-forward day; 07:30 UTC is 03:30 EDT.
    assert daily(time(3, 0))(_at("2026-03-08T07:30+00:00"), new_york) == "2026-03-08"
    # 06:30 UTC is 01:30 EST: not yet due that day.
    assert daily(time(3, 0))(_at("2026-03-08T06:30+00:00"), new_york) is None


def test_hourly_is_named_by_the_utc_hour_whatever_the_zone():
    key = hourly()(_at("2026-09-27T11:45+08:00"), MANILA)
    assert key == "2026-09-27T03"
    assert hourly()(_at("2026-09-27T03:10+00:00"), ZoneInfo("America/New_York")) == key


def test_an_unknown_or_malformed_timezone_falls_back_to_manila():
    assert tenant_zone(None) == MANILA
    assert tenant_zone("") == MANILA
    assert tenant_zone("Not/AZone") == MANILA
    assert tenant_zone("../../etc/passwd") == MANILA
    assert tenant_zone("Asia/Tokyo") == ZoneInfo("Asia/Tokyo")
