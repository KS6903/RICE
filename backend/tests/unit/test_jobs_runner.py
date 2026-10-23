"""The runner runs each due job once, retries failures a bounded number of
times, recovers runs whose runner died, and keeps tenants apart."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.jobs import runner
from app.jobs.registry import JOBS, Job, JobContext
from app.jobs.schedule import daily, hourly
from app.models.base import now_utc
from app.models.company import Company
from app.models.job_run import JobRun

NOW = datetime.fromisoformat("2026-09-27T03:05+08:00")


@pytest.fixture
def sessions(db_session: Session):
    """Sessions on the test's connection: their commits roll back with the test."""
    connection = db_session.connection()
    return lambda: Session(bind=connection, join_transaction_mode="create_savepoint")


def _runs(db_session: Session, job: str) -> list[JobRun]:
    db_session.expire_all()
    return list(db_session.scalars(select(JobRun).where(JobRun.job == job)))


class Counter:
    def __init__(self, fail_times: int = 0) -> None:
        self.calls = 0
        self.fail_times = fail_times

    def __call__(self, ctx: JobContext) -> str:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise RuntimeError(f"boom {self.calls}")
        return f"ran {self.calls}"


def test_a_due_platform_job_runs_once_per_run_key(db_session, sessions):
    work = Counter()
    job = Job("test.platform", "platform", hourly(), work)
    for _ in range(2):
        runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[])
    assert work.calls == 1
    [run] = _runs(db_session, "test.platform")
    assert (run.status, run.run_key, run.company_id, run.detail) == ("succeeded", "2026-09-26T19", None, "ran 1")

    runner.run_due_jobs(NOW + timedelta(hours=1), jobs=[job], session_factory=sessions, companies=[])
    assert work.calls == 2  # a new hour is a new run


def test_a_failed_run_is_retried_on_later_ticks_then_succeeds(db_session, sessions):
    work = Counter(fail_times=1)
    job = Job("test.flaky", "platform", hourly(), work)
    first = runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[])
    assert first.failed == ["test.flaky"]
    [run] = _runs(db_session, "test.flaky")
    assert run.status == "failed" and "RuntimeError: boom 1" in run.detail

    second = runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[])
    assert second.succeeded == ["test.flaky"]
    [run] = _runs(db_session, "test.flaky")
    assert (run.status, run.attempts) == ("succeeded", 2)


def test_a_run_that_keeps_failing_stops_after_max_attempts(db_session, sessions):
    work = Counter(fail_times=99)
    job = Job("test.broken", "platform", hourly(), work)
    for _ in range(runner.MAX_ATTEMPTS + 2):
        runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[])
    assert work.calls == runner.MAX_ATTEMPTS
    [run] = _runs(db_session, "test.broken")
    assert (run.status, run.attempts) == ("failed", runner.MAX_ATTEMPTS)


def test_a_run_whose_runner_died_is_claimed_again(db_session, sessions):
    job = Job("test.orphan", "platform", hourly(), Counter())
    run_key = job.schedule(NOW, None)
    db_session.add(JobRun(job=job.name, run_key=run_key, status="running", started_at=now_utc() - timedelta(hours=1)))
    db_session.commit()
    report = runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[])
    assert report.succeeded == ["test.orphan"]
    assert _runs(db_session, "test.orphan")[0].attempts == 2


def test_a_run_in_progress_elsewhere_is_left_alone(db_session, sessions):
    work = Counter()
    job = Job("test.busy", "platform", hourly(), work)
    db_session.add(JobRun(job=job.name, run_key=job.schedule(NOW, None), status="running", started_at=now_utc()))
    db_session.commit()
    runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[])
    assert work.calls == 0


def test_a_tenant_job_runs_in_that_tenant_schema_and_timezone(db_session, sessions, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    seen: list[str] = []

    def work(ctx: JobContext) -> str:
        seen.append(ctx.db.execute(text("SHOW search_path")).scalar_one().replace('"', ""))
        return "ok"

    job = Job("test.tenant", "tenant", daily(time(3, 0)), work)
    # 02:59 in Manila: not yet due for a Manila tenant.
    runner.run_due_jobs(NOW - timedelta(minutes=6), jobs=[job], session_factory=sessions, companies=[company])
    assert seen == []
    runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[company])
    assert seen == [f"{company.schema_name}, public"]
    [run] = _runs(db_session, "test.tenant")
    assert (run.company_id, run.run_key) == (company.id, "2026-09-27")


def test_a_job_sees_the_tenant_local_date_not_the_utc_date(db_session, sessions, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    seen: list[date] = []

    def work(ctx: JobContext) -> str:
        seen.append(ctx.local_today)
        return "ok"

    # 16:40 UTC on the 26th is 00:40 on the 27th in Manila.
    tick = datetime.fromisoformat("2026-09-26T16:40+00:00")
    job = Job("test.local-date", "tenant", daily(time(0, 30)), work)
    runner.run_due_jobs(tick, jobs=[job], session_factory=sessions, companies=[company])
    assert seen == [date(2026, 9, 27)]


def test_only_provisioned_active_tenants_are_visited(db_session, sessions, seed_owner):
    pending = Company(name="Not Yet Provisioned")
    closed = Company(name="Closed Mill", is_active=False, provisioned_at=now_utc())
    db_session.add_all([pending, closed])
    db_session.commit()
    visited = {c.id for c in runner._active_tenants(sessions)}
    assert seed_owner.company_id in visited
    assert pending.id not in visited and closed.id not in visited


def test_the_budget_stops_new_runs_and_leaves_them_due(db_session, sessions):
    work = Counter()
    job = Job("test.budget", "platform", hourly(), work)
    report = runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[], budget_seconds=-1)
    assert report.stopped_early and work.calls == 0
    runner.run_due_jobs(NOW, jobs=[job], session_factory=sessions, companies=[])
    assert work.calls == 1


def test_now_must_carry_a_timezone(sessions):
    with pytest.raises(ValueError, match="timezone-aware"):
        runner.run_due_jobs(datetime(2026, 9, 27, 3, 5), jobs=[], session_factory=sessions, companies=[])


def test_the_registered_jobs_run_cleanly(db_session, sessions, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    report = runner.run_due_jobs(NOW, jobs=JOBS, session_factory=sessions, companies=[company])
    assert report.failed == []
    assert sorted(report.succeeded) == sorted(
        [
            "subscriptions.sweep_expired",
            "platform.health_watch",
            f"invoices.mark_overdue[{company.id}]",
            f"automations.run[{company.id}]",
            f"actions.escalate[{company.id}]",
            f"automations.run_ai[{company.id}]",
            f"notifications.deliver_email[{company.id}]",
        ]
    )


def test_pruning_keeps_a_month_of_history_and_anything_still_running(db_session):
    now = now_utc()
    old = now - timedelta(days=31)
    db_session.add_all(
        [
            JobRun(job="test.prune", run_key="old-ok", status="succeeded", started_at=old, finished_at=old),
            JobRun(job="test.prune", run_key="old-failed", status="failed", started_at=old, finished_at=old),
            JobRun(job="test.prune", run_key="old-running", status="running", started_at=old),
            JobRun(job="test.prune", run_key="recent", status="succeeded", started_at=now - timedelta(days=29)),
        ]
    )
    db_session.commit()
    assert runner.prune_job_runs(db_session, now=now) == 2
    assert sorted(r.run_key for r in _runs(db_session, "test.prune")) == ["old-running", "recent"]
