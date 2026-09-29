"""Tenant timezones.

Each company keeps an IANA timezone (Company.timezone, Asia/Manila by default).
"Today" for a mill is its local date, not the server's: the containers run on
UTC, eight hours behind Manila, so between midnight and 08:00 in the
Philippines the server's date is still yesterday.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Manila"


def tenant_zone(name: str | None) -> ZoneInfo:
    """The tenant's timezone, or Manila when it is unset or not a real zone."""
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def local_today(zone_name: str | None, *, now: datetime | None = None) -> date:
    """The tenant's current date: ``now`` (default: this instant) in its timezone."""
    return (now or datetime.now(timezone.utc)).astimezone(tenant_zone(zone_name)).date()
