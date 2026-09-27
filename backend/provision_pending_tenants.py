"""Isolated tenant-DDL worker.

Run this as a separate process whose secret scope includes
PROVISIONER_DATABASE_URL. The API process explicitly rejects that credential.
"""

from __future__ import annotations

import argparse
import logging
import os
import time

# This must be set before importing app settings/database modules.
os.environ["PROCESS_ROLE"] = "provisioner"

from app.core.database import ProvisionerSessionLocal  # noqa: E402
from app.core.tenancy import provision_tenant  # noqa: E402
from app.models.company import Company  # noqa: E402

logger = logging.getLogger("ricemill.provisioner")


def provision_next() -> bool:
    company_id = None
    try:
        with ProvisionerSessionLocal() as db:
            company = (
                db.query(Company)
                .filter(
                    Company.provisioned_at.is_(None),
                    Company.provisioning_requested_at.is_not(None),
                    Company.provisioning_error.is_(None),
                )
                .order_by(Company.provisioning_requested_at)
                .with_for_update(skip_locked=True)
                .first()
            )
            if company is None:
                return False
            company_id = company.id
            provision_tenant(company, db=db)
            company.provisioning_error = None
            db.commit()
            logger.info("Tenant provisioning completed company=%s", company_id)
            return True
    except Exception:
        logger.exception("Tenant provisioning failed company=%s", company_id or "unknown")
        if company_id is not None:
            with ProvisionerSessionLocal() as db:
                company = db.get(Company, company_id)
                if company is not None and company.provisioned_at is None:
                    company.provisioning_error = "Provisioning failed; inspect the isolated worker logs."
                    db.commit()
        return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision queued tenant schemas")
    parser.add_argument("--watch", action="store_true", help="Continue polling for work")
    parser.add_argument("--poll-seconds", type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.poll_seconds <= 60:
        parser.error("--poll-seconds must be between 1 and 60")

    logging.basicConfig(level=logging.INFO)
    while True:
        processed = provision_next()
        if processed:
            continue
        if not args.watch:
            return 0
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
