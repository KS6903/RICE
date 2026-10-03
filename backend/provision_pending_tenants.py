"""Isolated tenant-DDL worker.

Run this as a separate process whose secret scope includes
PROVISIONER_DATABASE_URL. The API process explicitly rejects that credential.

Builds every tenant schema that is due (app/core/provisioning.py): queued and
not yet built, under its attempt limit, and past its back-off pause. A failure
is counted and retried later, never in a tight loop. The exit status is 1 when
anything failed, so the container reports it; 0 otherwise.
"""

from __future__ import annotations

import argparse
import enum
import logging
import os
import time

# This must be set before importing app settings/database modules.
os.environ["PROCESS_ROLE"] = "provisioner"

from app.core import provisioning  # noqa: E402
from app.core.database import ProvisionerSessionLocal  # noqa: E402
from app.core.tenancy import provision_tenant  # noqa: E402
from app.models.base import now_utc  # noqa: E402
from app.models.company import Company  # noqa: E402

logger = logging.getLogger("ricemill.provisioner")


class Outcome(enum.Enum):
    BUILT = "built"
    IDLE = "idle"  # nothing due
    FAILED = "failed"  # a tenant failed; it's counted and scheduled for retry
    UNAVAILABLE = "unavailable"  # couldn't even look (database down)


def provision_next() -> Outcome:
    company_id = None
    try:
        with ProvisionerSessionLocal() as db:
            company = (
                db.query(Company)
                .filter(provisioning.due(now_utc()))
                .order_by(Company.provisioning_requested_at)
                .with_for_update(skip_locked=True)
                .first()
            )
            if company is None:
                return Outcome.IDLE
            company_id = company.id
            provision_tenant(company, db=db)
            company.provisioning_error = None
            company.provisioning_next_attempt_at = None
            db.commit()
            logger.info("Tenant provisioning completed company=%s", company_id)
            return Outcome.BUILT
    except Exception:
        logger.exception("Tenant provisioning failed company=%s", company_id or "unknown")
        if company_id is None:
            return Outcome.UNAVAILABLE
        try:
            with ProvisionerSessionLocal() as db:
                company = db.get(Company, company_id)
                if company is not None and company.provisioned_at is None:
                    provisioning.record_failure(
                        company, now=now_utc(), message="Provisioning failed; inspect the isolated worker logs."
                    )
                    db.commit()
        except Exception:
            logger.exception("Couldn't record the failure company=%s", company_id)
            return Outcome.UNAVAILABLE
        return Outcome.FAILED


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision queued tenant schemas")
    parser.add_argument("--watch", action="store_true", help="Continue polling for work")
    parser.add_argument("--poll-seconds", type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.poll_seconds <= 60:
        parser.error("--poll-seconds must be between 1 and 60")

    logging.basicConfig(level=logging.INFO)
    failures = 0
    while True:
        outcome = provision_next()
        if outcome is Outcome.FAILED:
            # That tenant is now paused by its back-off, so the next pass moves on.
            failures += 1
            continue
        if outcome is Outcome.BUILT:
            continue
        # IDLE or UNAVAILABLE: nothing more to do on this pass.
        if not args.watch:
            return 1 if failures or outcome is Outcome.UNAVAILABLE else 0
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
