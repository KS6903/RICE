"""Weekly MFA "remember this device" reset boundary.

The trust window doesn't roll 7 days from when you verified — it expires at the
next **Sunday 00:00** in the configured local timezone, so every device
re-prompts for MFA on Sunday. (Philippines has no DST, so a fixed UTC offset is
exact year-round; configurable via settings for other deployments.)
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

from .config import settings


def _local_tz() -> timezone:
    return timezone(timedelta(hours=settings.MFA_TRUST_RESET_UTC_OFFSET_HOURS))


def next_reset_at() -> datetime:
    """The next weekly re-prompt boundary as a tz-aware UTC datetime: the coming
    Sunday 00:00 in the local timezone (strictly in the future — if it's already
    Sunday, this returns *next* Sunday so a Sunday verify lasts the whole week)."""
    tz = _local_tz()
    now_local = datetime.now(tz)
    # weekday(): Monday=0 … Sunday=6 → days until the next Sunday.
    days_ahead = (6 - now_local.weekday()) % 7
    candidate = datetime.combine(now_local.date(), time(0, 0), tzinfo=tz) + timedelta(days=days_ahead)
    if candidate <= now_local:
        candidate += timedelta(days=7)
    return candidate.astimezone(timezone.utc)


def seconds_until_reset() -> int:
    """Seconds from now until the next reset — used as the trust cookie max-age."""
    return max(1, int((next_reset_at() - datetime.now(timezone.utc)).total_seconds()))
