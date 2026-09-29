"""The scheduled jobs. A job listed here is run by the runner when it is due."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import TYPE_CHECKING, Literal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from .schedule import Schedule, daily, every_tick, hourly

if TYPE_CHECKING:
    from ..models.company import Company


@dataclass(frozen=True)
class JobContext:
    """What a job run gets to work with."""

    db: Session  # a tenant job's session is already on that tenant's schema
    now: datetime  # the tick's time (UTC)
    zone: ZoneInfo  # the tenant's timezone (Manila for platform jobs)
    run_key: str
    company: Company | None = None  # None for platform jobs

    @property
    def local_today(self) -> date:
        """The tenant's date at this tick, which is not the server's UTC date."""
        return self.now.astimezone(self.zone).date()


@dataclass(frozen=True)
class Job:
    name: str
    # platform: once per run key; tenant: once per run key for each tenant,
    # in that tenant's timezone and schema.
    scope: Literal["platform", "tenant"]
    schedule: Schedule
    # Does the work and returns a one-line summary for job_runs.detail.
    run: Callable[[JobContext], str]


def _sweep_expired_subscriptions(ctx: JobContext) -> str:
    from ..services.subscription import sweep_expired

    count = sweep_expired(ctx.db)  # commits its own work
    return f"{count} subscription(s) moved off an expired plan"


def _purge_stale_varieties(ctx: JobContext) -> str:
    from ..services.paddy_service import purge_stale_varieties

    count = purge_stale_varieties(ctx.db)
    ctx.db.commit()
    return f"{count} stale rice variet{'y' if count == 1 else 'ies'} deleted"


def _mark_overdue_invoices(ctx: JobContext) -> str:
    from ..services.sales_service import mark_overdue_invoices

    count = mark_overdue_invoices(ctx.db, today=ctx.local_today)
    ctx.db.commit()
    return f"{count} invoice(s) marked overdue"


def _run_automations(ctx: JobContext) -> str:
    from ..automations.engine import run_due_automations

    return run_due_automations(ctx)


def _deliver_notification_emails(ctx: JobContext) -> str:
    from ..services.notification_service import deliver_pending_emails

    outcome = deliver_pending_emails(ctx.db, now=ctx.now)  # commits
    return ", ".join(f"{count} {name}" for name, count in outcome.items())


JOBS: tuple[Job, ...] = (
    # Paid plans past their end date move to their queued plan or to Free.
    # Before this job that happened only lazily, on the tenant's own /auth/me
    # or from an admin button, so an idle tenant kept a lapsed plan.
    Job("subscriptions.sweep_expired", "platform", hourly(), _sweep_expired_subscriptions),
    # Varieties deactivated over 30 days ago. This used to be a loop inside the
    # API process that waited 24h before its first pass; containers sleep after
    # 30 idle minutes, so it never ran.
    Job("varieties.purge_stale", "tenant", daily(time(3, 0)), _purge_stale_varieties),
    # Unpaid and part-paid invoices past their due date become overdue, for
    # every plan: the status was defined but nothing ever set it. Shortly after
    # local midnight, so the day starts with it right.
    Job("invoices.mark_overdue", "tenant", daily(time(0, 30)), _mark_overdue_invoices),
    # Enterprise tenants' switched-on recipes (app/automations). Before the
    # email job, so what they produce goes out on the same tick.
    Job("automations.run", "tenant", every_tick(), _run_automations),
    # Notices that asked for email are sent after the work that produced them
    # committed, on the next tick, within a daily cap per tenant.
    Job("notifications.deliver_email", "tenant", every_tick(), _deliver_notification_emails),
)
