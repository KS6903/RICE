"""When a job is due, and what that run is called.

A schedule maps "now" (UTC) and the timezone the job runs in to a run key when
the job is due, else None. Ticks come every 15 minutes, so due means "the
scheduled time has passed"; job_runs remembers which run keys already ran. A
missed tick (an outage, a slow deploy) is caught up by the next one.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, time
from zoneinfo import ZoneInfo

from ..core.timezones import DEFAULT_TIMEZONE, tenant_zone

__all__ = ["DEFAULT_TIMEZONE", "Schedule", "daily", "every_tick", "hourly", "tenant_zone"]

Schedule = Callable[[datetime, ZoneInfo], "str | None"]

_UTC = ZoneInfo("UTC")


def daily(at: time) -> Schedule:
    """Due once a day from ``at`` local time; the run key is the local date."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        return local.date().isoformat() if local.time() >= at else None

    return schedule


def every_tick() -> Schedule:
    """Due on every tick; the run key is the UTC time floored to 15 minutes."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        utc = now.astimezone(_UTC)
        return utc.replace(minute=utc.minute - utc.minute % 15).strftime("%Y-%m-%dT%H:%M")

    return schedule


def hourly() -> Schedule:
    """Due once an hour; the run key is the UTC hour, whatever the timezone."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        return now.astimezone(_UTC).strftime("%Y-%m-%dT%H")

    return schedule
