"""Everything a mill has stored with us, as one ZIP of CSV files.

The data processing agreement promises it (§9): an export at any time during a
subscription, and for a window after one ends. So it's open on every plan, and
still open after a plan lapses. Only the owner can take it: it holds every
customer, price and employee record, government ID numbers included.

What goes in:
- every table in the mill's own schema, every column except stored files;
- from the shared tables, the mill's own rows, column by column from the
  allowlists below. A column added to a shared table later stays out until
  someone decides it belongs here.

What stays out, and why (README.txt in the ZIP says the same):
- sign-in secrets: password hashes, two-factor seeds and backup codes, and
  verification and session tokens. They protect the accounts and aren't
  records of the mill's business.
- report attachments that were emailed: they're built from rows that are in
  the export.
"""

from __future__ import annotations

import io
import json
import re
import tempfile
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import IO

from sqlalchemy import LargeBinary, Table, select, text
from sqlalchemy.orm import Session

from ..automations.csvfile import write_csv
from ..core import health
from ..core.config import settings
from ..core.tenancy import tenant_tables
from ..models.company import Branch, Company
from ..models.legal import LegalAcceptance
from ..models.subscription import Subscription, SubscriptionPlan
from ..models.upgrade_request import UpgradeRequest
from ..models.user import Role, User
from ..models.user_location import UserLocation

# Spooled: an ordinary mill's export stays in memory; a large one goes to disk.
_IN_MEMORY_BYTES = 32 * 1024 * 1024
_BATCH = 2000

_COMPANY_COLUMNS = (
    "id",
    "name",
    "address",
    "tin",
    "nfa_license_no",
    "da_registration_no",
    "phone",
    "email",
    "logo_url",
    "currency",
    "timezone",
    "is_multi_branch",
    "is_active",
    "created_at",
    "updated_at",
)
_USER_COLUMNS = (
    "id",
    "branch_id",
    "username",
    "email",
    "full_name",
    "is_active",
    "email_verified",
    "mfa_enabled",
    "last_login",
    "created_at",
    "updated_at",
)
_BRANCH_COLUMNS = ("id", "name", "address", "is_main_branch", "is_active", "deleted_at", "deleted_by")
_SUBSCRIPTION_COLUMNS = ("id", "status", "started_at", "expires_at", "trial_ends_at", "created_at", "updated_at")
_UPGRADE_REQUEST_COLUMNS = (
    "id",
    "requested_by",
    "request_type",
    "billing_interval",
    "status",
    "note",
    "admin_note",
    "resolved_at",
    "created_at",
    "updated_at",
)
_LEGAL_COLUMNS = (
    "id",
    "user_id",
    "agreement_version",
    "content_hash",
    "documents",
    "method",
    "ip_address",
    "user_agent",
    "accepted_at",
)
_LOCATION_COLUMNS = (
    "id",
    "user_id",
    "label",
    "lat",
    "lon",
    "country",
    "region",
    "is_default",
    "created_at",
    "updated_at",
)

# A column in the mill's own tables named like this would be a credential, not
# a business record; tests fail if one appears, so it's decided on, not leaked.
SECRET_COLUMN = re.compile(r"password|secret|token|hash|otp|api_key|credential|private_key", re.I)

README = """\
{app}: everything {company} has stored with us
Exported {exported_at} by {exported_by}.

One CSV file per kind of record, readable in Excel, Google Sheets or any
database tool. The files are UTF-8. manifest.json lists every file with its
row count.

- company.csv, branches.csv, users.csv: your mill, its branches and the
  people who sign in.
- subscriptions.csv, upgrade_requests.csv, legal_acceptances.csv: your plan,
  plan requests, and the agreements your users accepted.
- data/: every record your mill keeps with us, one file per table: palay
  purchases, milling, inventory, sales, payments, employees, deliveries,
  automations and the rest. Records refer to each other by their id columns.

Not included:
- sign-in secrets (password hashes, two-factor keys and backup codes,
  verification and session tokens). They protect the accounts and aren't
  records of your business.
- copies of report files we emailed you. They're built from the records here.

Text that a spreadsheet would read as a formula starts with an apostrophe (')
so it opens as plain text. Remove the apostrophe if you need the original.

This file holds personal data, including employees' government ID numbers.
Keep it somewhere only the people who need it can open.
"""


@dataclass
class Export:
    file: IO[bytes]
    filename: str
    rows: dict[str, int] = field(default_factory=dict)

    def chunks(self, size: int = 64 * 1024) -> Iterator[bytes]:
        """The ZIP's bytes, closing the file at the end."""
        try:
            self.file.seek(0)
            while chunk := self.file.read(size):
                yield chunk
        finally:
            self.file.close()


def exported_tables() -> list[Table]:
    """The mill's own tables, in a stable order."""
    return sorted(tenant_tables(), key=lambda t: t.name)


def exported_columns(table: Table) -> list:
    """Every column but stored files."""
    return [c for c in table.columns if not isinstance(c.type, LargeBinary)]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "mill"


def _rows(db: Session, stmt) -> Iterator[tuple]:
    for row in db.execute(stmt.execution_options(yield_per=_BATCH)):
        yield tuple(row)


def _write(zf: zipfile.ZipFile, name: str, header: list[str], rows: Iterator[tuple]) -> int:
    with zf.open(name, "w") as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as out:
        return write_csv(out, header, rows)


def _public(db: Session, model, columns: tuple[str, ...], *where, extra=()) -> tuple[list[str], Iterator[tuple]]:
    cols = [getattr(model, name) for name in columns]
    stmt = select(*cols, *[expr for _, expr in extra]).where(*where).order_by(model.id)
    return [*columns, *[label for label, _ in extra]], _rows(db, stmt)


def build(db: Session, company: Company, *, exported_by: User, now: datetime) -> Export:
    """Write the ZIP. ``db`` must already be scoped to ``company``'s schema."""
    current = db.execute(text("SELECT current_schema()")).scalar()
    if current != company.schema_name:
        # Fail closed: never dump whatever schema a session happens to be on.
        raise RuntimeError("the session isn't scoped to this company's schema")

    file = tempfile.SpooledTemporaryFile(max_size=_IN_MEMORY_BYTES)
    export = Export(file=file, filename=f"{_slug(company.name)}-data-{now:%Y-%m-%d}.zip")
    try:
        with zipfile.ZipFile(file, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            cid = company.id
            plan = SubscriptionPlan.__table__
            public = {
                "company.csv": _public(db, Company, _COMPANY_COLUMNS, Company.id == cid),
                "branches.csv": _public(db, Branch, _BRANCH_COLUMNS, Branch.company_id == cid),
                "users.csv": _public(
                    db,
                    User,
                    _USER_COLUMNS,
                    User.company_id == cid,
                    extra=[("role", select(Role.name).where(Role.id == User.role_id).scalar_subquery())],
                ),
                "subscriptions.csv": _public(
                    db,
                    Subscription,
                    _SUBSCRIPTION_COLUMNS,
                    Subscription.company_id == cid,
                    extra=[
                        ("plan", select(plan.c.name).where(plan.c.id == Subscription.plan_id).scalar_subquery()),
                        (
                            "queued_plan",
                            select(plan.c.name).where(plan.c.id == Subscription.queued_plan_id).scalar_subquery(),
                        ),
                    ],
                ),
                "upgrade_requests.csv": _public(
                    db,
                    UpgradeRequest,
                    _UPGRADE_REQUEST_COLUMNS,
                    UpgradeRequest.company_id == cid,
                    extra=[
                        (
                            "requested_plan",
                            select(plan.c.name).where(plan.c.id == UpgradeRequest.requested_plan_id).scalar_subquery(),
                        )
                    ],
                ),
                "legal_acceptances.csv": _public(
                    db, LegalAcceptance, _LEGAL_COLUMNS, LegalAcceptance.company_id == cid
                ),
                "user_locations.csv": _public(
                    db,
                    UserLocation,
                    _LOCATION_COLUMNS,
                    UserLocation.user_id.in_(select(User.id).where(User.company_id == cid)),
                ),
            }
            for name, (header, rows) in public.items():
                export.rows[name] = _write(zf, name, header, rows)

            for table in exported_tables():
                cols = exported_columns(table)
                stmt = select(*cols).order_by(*(table.primary_key.columns or cols[:1]))
                if "company_id" in table.c:
                    stmt = stmt.where(table.c.company_id == cid)
                name = f"data/{table.name}.csv"
                export.rows[name] = _write(zf, name, [c.name for c in cols], _rows(db, stmt))

            stamp = now.strftime("%Y-%m-%d %H:%M UTC")
            who = exported_by.full_name or exported_by.username
            zf.writestr(
                "README.txt",
                README.format(app=settings.APP_NAME, company=company.name, exported_at=stamp, exported_by=who),
            )
            manifest = {
                "company": company.name,
                "exported_at": now.isoformat(),
                "exported_by": exported_by.username,
                "schema_version": list(health.code_heads()),
                "files": export.rows,
            }
            zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
    except BaseException:
        file.close()
        raise
    return export
