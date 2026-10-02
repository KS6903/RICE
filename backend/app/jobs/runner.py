"""Run whichever scheduled jobs are due, each run at most once.

Every run is claimed in job_runs before any work starts. The claim is an
INSERT that a unique (job, company_id, run_key) index turns into a no-op when
the run already happened or is in progress, so overlapping runners can't
double up. The claim is taken back only for a run that failed, or that has sat
in "running" long enough that its runner must have died, and then only up to
MAX_ATTEMPTS times.
"""

from __future__ import annotations

import logging
import time as clock
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.tenancy import set_search_path
from ..models.base import now_utc
from ..models.company import Company
from ..models.job_run import JobRun
from .registry import JOBS, Job, JobContext
from .schedule import DEFAULT_TIMEZONE, tenant_zone

logger = logging.getLogger("ricemill.jobs")

MAX_ATTEMPTS = 3
# A run still "running" after this long lost its runner (a container stopped
# mid-run, a deploy) and may be claimed again.
STALE_AFTER = timedelta(minutes=30)
# Stop starting runs after this long. Anything left is still due on the next
# tick, 15 minutes later.
DEFAULT_BUDGET_SECONDS = 240.0


@dataclass
class Report:
    succeeded: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    stopped_early: bool = False


def run_due_jobs(
    now: datetime,
    *,
    jobs: Sequence[Job] = JOBS,
    session_factory: Callable[[], Session] = SessionLocal,
    companies: Iterable[Company] | None = None,
    budget_seconds: float = DEFAULT_BUDGET_SECONDS,
) -> Report:
    """Run every job that is due at ``now``. ``companies`` defaults to every
    provisioned, active tenant; tests pass their own, and their own sessions."""
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    deadline = clock.monotonic() + budget_seconds
    report = Report()
    tenants = list(companies) if companies is not None else None
    for job in jobs:
        if job.scope == "platform":
            targets: list[Company | None] = [None]
        else:
            if tenants is None:
                tenants = _active_tenants(session_factory)
            targets = list(tenants)
        for company in targets:
            if clock.monotonic() > deadline:
                report.stopped_early = True
                logger.warning("tick budget spent; the rest waits for the next tick")
                return report
            zone = tenant_zone(company.timezone if company is not None else DEFAULT_TIMEZONE)
            run_key = job.schedule(now, zone)
            if run_key is not None:
                _run_once(job, company, now, zone, run_key, session_factory, report)
    return report


def _active_tenants(session_factory: Callable[[], Session]) -> list[Company]:
    """Tenants whose schema exists: an unprovisioned company has nowhere to run."""
    with session_factory() as db:
        companies = list(
            db.scalars(
                select(Company)
                .where(Company.provisioned_at.is_not(None), Company.is_active.is_(True))
                .order_by(Company.id)
            )
        )
        db.expunge_all()
    return companies


def _run_once(
    job: Job,
    company: Company | None,
    now: datetime,
    zone: ZoneInfo,
    run_key: str,
    session_factory: Callable[[], Session],
    report: Report,
) -> None:
    company_id = company.id if company is not None else None
    context = {"job": job.name, "company_id": str(company_id) if company_id else None, "run_key": run_key}
    label = job.name if company_id is None else f"{job.name}[{company_id}]"
    with session_factory() as ledger:
        run_id = claim_run(ledger, job.name, company_id, run_key)
        if run_id is None:
            return  # done already, running elsewhere, or out of attempts
        started = clock.monotonic()
        try:
            # A fresh session per run: nothing (schema, failed transaction)
            # carries over from one tenant to the next.
            with session_factory() as db:
                if company is not None:
                    set_search_path(db, company.schema_name)
                summary = job.run(JobContext(db=db, now=now, zone=zone, run_key=run_key, company=company))
        except Exception as exc:
            finish_run(ledger, run_id, "failed", f"{type(exc).__name__}: {exc}"[:500])
            report.failed.append(label)
            logger.exception("job failed", extra=context)
            return
        finish_run(ledger, run_id, "succeeded", summary)
        report.succeeded.append(label)
        logger.info(
            "job succeeded",
            extra={**context, "summary": summary, "seconds": round(clock.monotonic() - started, 3)},
        )


def claim_run(db: Session, job: str, company_id: uuid.UUID | None, run_key: str) -> uuid.UUID | None:
    """Claim a run; None when it is already done, in progress, or spent."""
    table = JobRun.__table__
    now = now_utc()
    stmt = (
        insert(JobRun)
        .values(
            id=uuid.uuid4(),
            job=job,
            company_id=company_id,
            run_key=run_key,
            status="running",
            attempts=1,
            started_at=now,
        )
        .on_conflict_do_update(
            index_elements=[table.c.job, table.c.company_id, table.c.run_key],
            set_={
                "status": "running",
                "attempts": table.c.attempts + 1,
                "started_at": now,
                "finished_at": None,
                "detail": None,
            },
            where=and_(
                table.c.attempts < MAX_ATTEMPTS,
                or_(
                    table.c.status == "failed",
                    and_(table.c.status == "running", table.c.started_at < now - STALE_AFTER),
                ),
            ),
        )
        .returning(table.c.id)
    )
    run_id = db.execute(stmt).scalar_one_or_none()
    db.commit()
    return run_id


def finish_run(db: Session, run_id: uuid.UUID, status: str, detail: str) -> None:
    db.execute(update(JobRun).where(JobRun.id == run_id).values(status=status, finished_at=now_utc(), detail=detail))
    db.commit()


KEEP_RUNS_FOR = timedelta(days=30)


def prune_job_runs(db: Session, *, now: datetime) -> int:
    """Delete finished runs older than KEEP_RUNS_FOR. Does not commit.

    Safe because no run key repeats: they're dates, hours and tick times, so a
    deleted run can never be claimed again. Runs still "running" stay, however
    old, for the stale-run recovery to find."""
    result = db.execute(delete(JobRun).where(JobRun.status != "running", JobRun.started_at < now - KEEP_RUNS_FOR))
    return result.rowcount  # type: ignore[attr-defined]
