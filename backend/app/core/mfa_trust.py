"""Weekly MFA "remember this device" reset boundary.

The trust window doesn't roll 7 days from when you verified — it expires at the
next **Sunday 00:00 in the user's own local time**, so every device re-prompts
for MFA once a week, on Sunday wherever the user is. The zone is the one their
browser reports when they verify; failing that, their company's; failing that,
Manila. Real IANA zones follow daylight saving, which a fixed offset cannot.

Any real zone is accepted without further checks: whichever it is, the next
local Sunday midnight is at most a week away, so a wrong or spoofed zone can
move the reset around the week but never stretch trust past seven days.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..jobs.schedule import DEFAULT_TIMEZONE


def local_zone(browser_zone: str | None, company_zone: str | None) -> ZoneInfo:
    """The user's zone: what their browser reports, else their company's, else
    Manila. A name that isn't a real IANA zone is skipped, never trusted."""
    for name in (browser_zone, company_zone):
        if not name:
            continue
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return ZoneInfo(DEFAULT_TIMEZONE)


def next_reset_at(zone: ZoneInfo, now: datetime | None = None) -> datetime:
    """The next weekly re-prompt boundary as a tz-aware UTC datetime: the coming
    Sunday 00:00 in ``zone`` (strictly in the future — if it's already Sunday,
    this returns *next* Sunday so a Sunday verify lasts the whole week)."""
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    today = now_utc.astimezone(zone).date()
    # weekday(): Monday=0 … Sunday=6 → days until the coming Sunday.
    sunday = today + timedelta(days=(6 - today.weekday()) % 7)
    reset = datetime.combine(sunday, time(0, 0), tzinfo=zone).astimezone(timezone.utc)
    if reset <= now_utc:
        reset = datetime.combine(sunday + timedelta(days=7), time(0, 0), tzinfo=zone).astimezone(timezone.utc)
    return reset
