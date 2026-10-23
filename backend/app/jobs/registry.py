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


def _mark_overdue_invoices(ctx: JobContext) -> str:
    from ..services.sales_service import mark_overdue_invoices

    count = mark_overdue_invoices(ctx.db, today=ctx.local_today)
    ctx.db.commit()
    return f"{count} invoice(s) marked overdue"


def _run_automations(ctx: JobContext) -> str:
    from ..automations.engine import run_due_automations

    return run_due_automations(ctx)


def _run_ai_automations(ctx: JobContext) -> str:
    from ..automations.engine import run_due_automations

    return run_due_automations(ctx, ai=True)


def _escalate_actions(ctx: JobContext) -> str:
    from ..automations.actions import escalate
    from ..automations.engine import entitled

    assert ctx.company is not None
    if not entitled(ctx.db, ctx.company.id):
        return "the plan doesn't include automations"
    count = escalate(ctx.db, ctx.company, now=ctx.now, zone=ctx.zone)
    ctx.db.commit()
    return f"{count} overdue task(s) escalated"


def _deliver_notification_emails(ctx: JobContext) -> str:
    from ..services.notification_service import deliver_pending_emails

    outcome = deliver_pending_emails(ctx.db, now=ctx.now)  # commits
    return ", ".join(f"{count} {name}" for name, count in outcome.items())


def _prune_notification_attachments(ctx: JobContext) -> str:
    from ..services.notification_service import prune_attachments

    count = prune_attachments(ctx.db, now=ctx.now)
    ctx.db.commit()
    return f"{count} old attachment(s) deleted"


def _remind_expiring(ctx: JobContext) -> str:
    from ..services.platform_jobs import remind_expiring

    assert ctx.company is not None
    count = remind_expiring(ctx.db, ctx.company, today=ctx.local_today, zone=ctx.zone)
    ctx.db.commit()
    return f"{count} plan-ending reminder(s)"


def _purge_auth_records(ctx: JobContext) -> str:
    from ..services.platform_jobs import purge_auth_records

    tokens, sessions = purge_auth_records(ctx.db, now=ctx.now)
    ctx.db.commit()
    return f"{tokens} reset token(s) and {sessions} session(s) deleted"


def _redis_budget(ctx: JobContext) -> str:
    from ..services.platform_jobs import redis_budget

    return redis_budget(ctx.db, now=ctx.now)


def _health_watch(ctx: JobContext) -> str:
    from ..services.platform_jobs import health_watch

    return health_watch(ctx.db, now=ctx.now)


def _prune_job_runs(ctx: JobContext) -> str:
    from .runner import prune_job_runs

    count = prune_job_runs(ctx.db, now=ctx.now)
    ctx.db.commit()
    return f"{count} old job run(s) deleted"


JOBS: tuple[Job, ...] = (
    # Paid plans past their end date move to their queued plan or to Free.
    # Before this job that happened only lazily, on the tenant's own /auth/me
    # or from an admin button, so an idle tenant kept a lapsed plan.
    Job("subscriptions.sweep_expired", "platform", hourly(), _sweep_expired_subscriptions),
    # Unpaid and part-paid invoices past their due date become overdue, for
    # every plan: the status was defined but nothing ever set it. Shortly after
    # local midnight, so the day starts with it right.
    Job("invoices.mark_overdue", "tenant", daily(time(0, 30)), _mark_overdue_invoices),
    # Enterprise tenants' switched-on recipes (app/automations). Before the
    # email job, so what they produce goes out on the same tick.
    Job("automations.run", "tenant", every_tick(), _run_automations),
    # Tasks past due and not resolved go to the owner and admins, once. Before
    # the email job, so the escalation goes out on the same tick.
    Job("actions.escalate", "tenant", every_tick(), _escalate_actions),
    # Notices that asked for email are sent after the work that produced them
    # committed, on the next tick, within a daily cap per tenant.
    Job("notifications.deliver_email", "tenant", every_tick(), _deliver_notification_emails),
    # Report files kept for those emails, once the emails are long gone.
    Job("notifications.prune_attachments", "tenant", daily(time(3, 15)), _prune_notification_attachments),
    # Every-tick jobs and recipes claim a row per tick; keep a month of history.
    # A deleted run can't come round again: run keys are dates and times.
    Job("job_runs.prune", "platform", daily(time(3, 30)), _prune_job_runs),
    # Owners and admins hear 7 days and 1 day before a paid plan or trial ends,
    # instead of finding out when features stop.
    Job("subscriptions.remind_expiring", "tenant", daily(time(9, 0)), _remind_expiring),
    # Spent reset links and long-expired sessions; nothing can use them.
    Job("auth.purge_expired", "platform", daily(time(3, 45)), _purge_auth_records),
    # Upstash bills per command: warn before the month's quota runs out.
    Job("platform.redis_budget", "platform", daily(time(8, 0)), _redis_budget),
    # Schema drift, Redis down, tenants stuck or failing setup: email the
    # platform admins, once a day per problem.
    Job("platform.health_watch", "platform", hourly(), _health_watch),
    # AI recipes (once the owner switches AI on) last: a model call can take a
    # couple of minutes, and the tick's time budget must not run out before the
    # quick work and the emails are done. Their emails go out on the next tick.
    Job("automations.run_ai", "tenant", every_tick(), _run_ai_automations),
)
