"""When a tenant's schema gets built, and what to do when building it fails.

The API only queues a tenant (provisioning_requested_at); the isolated
provisioner (provision_pending_tenants.py) builds the schema. A failure is
retried after a growing pause, up to MAX_ATTEMPTS; after that the tenant waits
for a platform admin's Retry. A queued tenant also tells the Worker, through a
response header, to start the provisioner at once instead of at the next
15-minute tick.
"""

from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

from ..models.company import Company

MAX_ATTEMPTS = 5
# Pause after the 1st, 2nd, 3rd... failure. The last one is reused.
BACKOFF = (timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1))

# The header the Worker looks for and strips (worker/index.ts).
QUEUED_HEADER = "X-Provisioning-Queued"

State = Literal["provisioned", "queued", "retrying", "failed", "not_requested"]


def due(now: datetime) -> ColumnElement[bool]:
    """Tenants the provisioner should build now."""
    return and_(
        Company.provisioned_at.is_(None),
        Company.provisioning_requested_at.is_not(None),
        Company.provisioning_attempts < MAX_ATTEMPTS,
        or_(Company.provisioning_next_attempt_at.is_(None), Company.provisioning_next_attempt_at <= now),
    )


def record_failure(company: Company, *, now: datetime, message: str) -> None:
    """Count a failed attempt and schedule the next. Doesn't commit."""
    company.provisioning_attempts = (company.provisioning_attempts or 0) + 1
    company.provisioning_error = message[:120]
    pause = BACKOFF[min(company.provisioning_attempts, len(BACKOFF)) - 1]
    company.provisioning_next_attempt_at = now + pause


def request(company: Company, *, now: datetime) -> bool:
    """Queue a tenant's schema, from scratch: a fresh request clears earlier
    failures. True when it was queued (it isn't when it already exists)."""
    if company.provisioned_at is not None:
        return False
    company.provisioning_requested_at = company.provisioning_requested_at or now
    company.provisioning_error = None
    company.provisioning_attempts = 0
    company.provisioning_next_attempt_at = None
    mark_queued()
    return True


def state(company: Company) -> State:
    if company.provisioned_at is not None:
        return "provisioned"
    if company.provisioning_requested_at is None:
        return "not_requested"
    if (company.provisioning_attempts or 0) >= MAX_ATTEMPTS:
        return "failed"
    return "retrying" if company.provisioning_attempts else "queued"


def describe(company: Company) -> dict:
    return {
        "state": state(company),
        "attempts": company.provisioning_attempts or 0,
        "max_attempts": MAX_ATTEMPTS,
        "error": company.provisioning_error,
        "requested_at": company.provisioning_requested_at.isoformat() if company.provisioning_requested_at else None,
        "next_attempt_at": (
            company.provisioning_next_attempt_at.isoformat() if company.provisioning_next_attempt_at else None
        ),
        "provisioned_at": company.provisioned_at.isoformat() if company.provisioned_at else None,
    }


# ── "a tenant was queued in this request" ────────────────────────────────────
# A mutable holder per request (middleware.ProvisioningSignalMiddleware): sync
# endpoints run in a worker thread with a copy of the context, so a plain
# ContextVar.set() there would never be seen by the middleware.
_queued: ContextVar[list[bool] | None] = ContextVar("provisioning_queued", default=None)


def start_request() -> list[bool]:
    holder: list[bool] = []
    _queued.set(holder)
    return holder


def mark_queued() -> None:
    holder = _queued.get()
    if holder is not None:
        holder.append(True)
