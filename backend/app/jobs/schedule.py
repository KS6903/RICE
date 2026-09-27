"""When a job is due, and what that run is called.

A schedule maps "now" (UTC) and the timezone the job runs in to a run key when
the job is due, else None. Ticks come every 15 minutes, so due means "the
scheduled time has passed"; job_runs remembers which run keys already ran. A
missed tick (an outage, a slow deploy) is caught up by the next one.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

Schedule = Callable[[datetime, ZoneInfo], "str | None"]

DEFAULT_TIMEZONE = "Asia/Manila"
_UTC = ZoneInfo("UTC")


def tenant_zone(name: str | None) -> ZoneInfo:
    """The tenant's timezone, or Manila when it is unset or not a real zone."""
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def daily(at: time) -> Schedule:
    """Due once a day from ``at`` local time; the run key is the local date."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        return local.date().isoformat() if local.time() >= at else None

    return schedule


def hourly() -> Schedule:
    """Due once an hour; the run key is the UTC hour, whatever the timezone."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        return now.astimezone(_UTC).strftime("%Y-%m-%dT%H")

    return schedule
