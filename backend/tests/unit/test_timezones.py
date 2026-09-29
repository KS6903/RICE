"""A mill's "today" is its local date, not the server's UTC date."""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.core.timezones import local_today


def test_local_today_is_the_tenant_date_not_the_utc_date():
    # 17:00 UTC on the 27th is already 01:00 on the 28th in Manila.
    now = datetime(2026, 9, 27, 17, 0, tzinfo=timezone.utc)
    assert local_today("Asia/Manila", now=now) == date(2026, 9, 28)
    assert local_today("UTC", now=now) == date(2026, 9, 27)


def test_an_unset_timezone_means_manila():
    now = datetime(2026, 9, 27, 17, 0, tzinfo=timezone.utc)
    assert local_today(None, now=now) == date(2026, 9, 28)
