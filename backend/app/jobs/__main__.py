"""Run the scheduled jobs that are due, then exit. The JobsContainer entrypoint.

python -m app.jobs                                  # as of now
python -m app.jobs --now 2026-09-27T03:05+08:00     # as if it were then
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

# Before anything reads settings: this process is the jobs role whatever the
# environment says, so the validator refuses it the provisioner's DDL secret.
os.environ["PROCESS_ROLE"] = "jobs"

from ..core.config import settings  # noqa: E402
from ..core.logging_config import configure_logging  # noqa: E402

logger = logging.getLogger("ricemill.jobs")


def _parse_now(parser: argparse.ArgumentParser, value: str | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        parser.error(f"--now: not an ISO timestamp: {value!r}")
    if parsed.tzinfo is None:
        parser.error("--now needs a UTC offset, e.g. 2026-09-27T03:05+08:00")
    return parsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.jobs", description="Run the scheduled jobs that are due.")
    parser.add_argument("--now", help="run as if it were this time (ISO 8601 with offset)")
    args = parser.parse_args(argv)
    now = _parse_now(parser, args.now)

    configure_logging(json_output=settings.is_prod)
    if settings.is_prod:
        from ..core.database import engine
        from ..core.runtime_role import verify_runtime_database_role

        verify_runtime_database_role(engine, settings.RUNTIME_DATABASE_ROLE)

    from .runner import run_due_jobs

    report = run_due_jobs(now)
    logger.info(
        "tick finished",
        extra={
            "succeeded": len(report.succeeded),
            "failed": len(report.failed),
            "stopped_early": report.stopped_early,
        },
    )
    # A failed job makes the container exit non-zero, so it shows up in the
    # platform's logs as well as in job_runs.
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
