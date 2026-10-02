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

__all__ = ["DEFAULT_TIMEZONE", "Schedule", "daily", "every_tick", "hourly", "monthly", "tenant_zone", "weekly"]

Schedule = Callable[[datetime, ZoneInfo], "str | None"]

_UTC = ZoneInfo("UTC")

MONDAY, SATURDAY, SUNDAY = 0, 5, 6


def daily(at: time, *, days: frozenset[int] | None = None) -> Schedule:
    """Due once a day from ``at`` local time; the run key is the local date.
    ``days`` limits it to those weekdays (Monday is 0)."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        if days is not None and local.weekday() not in days:
            return None
        return local.date().isoformat() if local.time() >= at else None

    return schedule


def weekly(weekday: int, at: time) -> Schedule:
    """Due on that weekday (Monday is 0) from ``at`` local time until midnight;
    the run key is the ISO week, e.g. 2026-W40."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        if local.weekday() != weekday or local.time() < at:
            return None
        year, week, _ = local.isocalendar()
        return f"{year}-W{week:02d}"

    return schedule


def monthly(day: int, at: time) -> Schedule:
    """Due from ``at`` local time on that day of the month until the month
    ends; the run key is the month, e.g. 2026-10. Day 1 is the usual choice."""

    def schedule(now: datetime, zone: ZoneInfo) -> str | None:
        local = now.astimezone(zone)
        if (local.day, local.time()) < (day, at):
            return None
        return f"{local.year}-{local.month:02d}"

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
