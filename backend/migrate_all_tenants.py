"""Apply per-client (tenant) schema DDL across every existing client.

Public-schema changes go through Alembic (``alembic upgrade head``). The per-client
domain tables live in many ``client_<hex>`` schemas, so this script visits each one
and brings it in line with the ORM models.

What it does: for every company, set search_path to its schema and run
``create_all`` for the tenant tables (additive — creates any tables missing from
that schema). Re-runnable and safe.

Note: ``create_all`` adds missing *tables* but not new *columns* on existing
tables. For a column/constraint change, add the equivalent ``ALTER TABLE`` to
``_extra_ddl`` below (it runs per schema, after create_all).

Usage:
    cd backend && .venv/Scripts/python migrate_all_tenants.py
"""

from __future__ import annotations

import os

from sqlalchemy import text

os.environ["PROCESS_ROLE"] = "provisioner"

from app.core.config import settings
from app.core.database import Base, ProvisionerSessionLocal
from app.core.tenancy import (
    grant_runtime_schema_access,
    schema_name_for,
    set_search_path,
    tenant_tables,
)
from app.models.company import Company

# One-off ALTERs to apply inside each client schema (e.g. "ALTER TABLE sales_orders
# ADD COLUMN IF NOT EXISTS …"). Keep idempotent.
_extra_ddl: list[str] = [
    # The colour indexes were only ever made by a one-off script from the days
    # before schema-per-tenant, so no tenant schema had them.
    *(
        f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table}_company_color "
        f"ON {table} (company_id, canva_color_hex) WHERE canva_color_hex IS NOT NULL"
        for table in ("suppliers", "customers", "agents", "millers")
    ),
    # Failed notification emails are retried (notification_service.RETRY_AFTER).
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_attempts SMALLINT NOT NULL DEFAULT 0",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_retry_at TIMESTAMPTZ",
    # Alerts tracked as tasks until resolved (action_items, made by create_all).
    "ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS track BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS track_assignee UUID REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS track_due_hours SMALLINT NOT NULL DEFAULT 24",
    # Who delivers an order: the customer or the rice mill's courier, plus a note.
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS courier_type VARCHAR(20)",
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS courier_notes TEXT",
    # The vehicle and the driver that take it.
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS courier_plate VARCHAR(20)",
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS courier_driver VARCHAR(150)",
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS courier_phone VARCHAR(20)",
    # When a trip's status last changed (a departed or delivered trip locks a week later).
    "ALTER TABLE dispatch_trips ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ",
    # How an employee's salary is paid, and the details that method needs.
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_method VARCHAR(20)",
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_provider VARCHAR(100)",
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_account_name VARCHAR(150)",
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_account_no VARCHAR(40)",
    # The client whose palay a milling batch is (custom milling).
    "ALTER TABLE milling_batches ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id)",
    # What the client and the mill agreed, and the terms.
    "ALTER TABLE milling_batches ADD COLUMN IF NOT EXISTS client_arrangement VARCHAR(30)",
    "ALTER TABLE milling_batches ADD COLUMN IF NOT EXISTS client_notes TEXT",
]


def migrate_all() -> int:
    """Returns how many tenants failed."""
    db = ProvisionerSessionLocal()
    try:
        companies = db.query(Company).all()
    finally:
        db.close()

    print(f"Syncing {len(companies)} client schema(s)...")
    failed = 0
    for company in companies:
        if company.provisioned_at is None:
            # No schema yet: the provisioner builds it, already current.
            print(f"  - {company.name}: not provisioned yet, skipped")
            continue
        schema = schema_name_for(company)
        session = ProvisionerSessionLocal()
        try:
            set_search_path(session, schema)
            Base.metadata.create_all(bind=session.connection(), tables=tenant_tables())
            for stmt in _extra_ddl:
                session.execute(text(stmt))
            if settings.PROVISIONER_DATABASE_URL is not None:
                grant_runtime_schema_access(session, schema)
            session.commit()
            print(f"  ok {schema} ({company.name})")
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            failed += 1
            print(f"  FAILED {schema} ({company.name}): {exc}")
        finally:
            session.close()
    print(f"Done: {len(companies) - failed} ok, {failed} failed.")
    return failed


if __name__ == "__main__":
    # Non-zero when any tenant failed, so a deploy stops instead of rolling
    # out code against a half-migrated database.
    raise SystemExit(1 if migrate_all() else 0)
