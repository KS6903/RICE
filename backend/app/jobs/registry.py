"""The scheduled jobs. A job listed here is run by the runner when it is due."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import time
from typing import Literal

from sqlalchemy.orm import Session

from .schedule import Schedule, daily, hourly


@dataclass(frozen=True)
class Job:
    name: str
    # platform: once per run key; tenant: once per run key for each tenant,
    # in that tenant's timezone and schema.
    scope: Literal["platform", "tenant"]
    schedule: Schedule
    # Does the work in the given session (a tenant job's session is already on
    # that tenant's schema) and returns a one-line summary for job_runs.detail.
    run: Callable[[Session], str]


def _sweep_expired_subscriptions(db: Session) -> str:
    from ..services.subscription import sweep_expired

    count = sweep_expired(db)  # commits its own work
    return f"{count} subscription(s) moved off an expired plan"


def _purge_stale_varieties(db: Session) -> str:
    from ..services.paddy_service import purge_stale_varieties

    count = purge_stale_varieties(db)
    db.commit()
    return f"{count} stale rice variet{'y' if count == 1 else 'ies'} deleted"


JOBS: tuple[Job, ...] = (
    # Paid plans past their end date move to their queued plan or to Free.
    # Before this job that happened only lazily, on the tenant's own /auth/me
    # or from an admin button, so an idle tenant kept a lapsed plan.
    Job("subscriptions.sweep_expired", "platform", hourly(), _sweep_expired_subscriptions),
    # Varieties deactivated over 30 days ago. This used to be a loop inside the
    # API process that waited 24h before its first pass; containers sleep after
    # 30 idle minutes, so it never ran.
    Job("varieties.purge_stale", "tenant", daily(time(3, 0)), _purge_stale_varieties),
)
