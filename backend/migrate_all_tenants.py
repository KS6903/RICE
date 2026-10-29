"""Apply per-client (tenant) schema DDL across every existing client.

Public-schema changes go through Alembic (``alembic upgrade head``). The per-client
domain tables live in many ``client_<hex>`` schemas, so this script visits each one
and brings it in line with the ORM models.

What it does: for every company, set search_path to its schema and run
``create_all`` for the tenant tables (additive — creates any tables missing from
that schema). Re-runnable and safe.

It also moves each schema's default varieties to the current lists
(``sync_system_varieties``): the old rice ones (NSIC Rc222 and the rest) are renamed
in place, and the palay ones are added once, with the palay records moved to them.

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
    seed_default_expense_categories,
    set_search_path,
    sync_system_varieties,
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
    # The categories every mill starts with can't be deleted (filled in below).
    "ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false",
    # Milled rice is Graded Rice, Straight Mill Rice, Broken Rice, Well-Milled Rice or
    # Regular-Milled Rice (it was premium, regular or broken, and for a day graded, straight
    # mill or broken). Stock, sales lines, rice purchases and price lists follow, so a list
    # price still matches the lines it prices.
    *(
        f"UPDATE {table} SET grade_name = '{new}' WHERE grade_name = '{old}'"
        for table in ("milled_rice_inventory", "sales_order_items", "rice_purchase_items", "price_lists")
        for old, new in (
            ("premium", "Graded Rice"),
            ("graded", "Graded Rice"),
            ("regular", "Straight Mill Rice"),
            ("straight mill", "Straight Mill Rice"),
            ("broken", "Broken Rice"),
        )
    ),
    # Palay and rice have their own variety lists. A variety a mill made before
    # then stays on both pages ("both"); the standard ones stay rice, and
    # sync_system_varieties gives the palay ones. Only when the column is new.
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'rice_varieties' AND column_name = 'kind'
        ) THEN
            ALTER TABLE rice_varieties ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'rice';
            UPDATE rice_varieties SET kind = 'both' WHERE company_id IS NOT NULL;
        END IF;
    END $$
    """,
    # A palay line is counted in sacks (cavans and kilos optional), and can be
    # bought wet and dried later, with the weight and moisture after drying.
    "ALTER TABLE palay_purchase_items ADD COLUMN IF NOT EXISTS sack_count NUMERIC(10, 2)",
    "ALTER TABLE palay_purchase_items ADD COLUMN IF NOT EXISTS is_wet BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE palay_purchase_items ADD COLUMN IF NOT EXISTS dried_weight_kg NUMERIC(10, 3)",
    "ALTER TABLE palay_purchase_items ADD COLUMN IF NOT EXISTS dried_moisture_pct NUMERIC(5, 2)",
    "ALTER TABLE palay_purchase_items ADD COLUMN IF NOT EXISTS dried_at TIMESTAMPTZ",
    # A palay purchase with nothing left to dry is completed (it was "received").
    """
    UPDATE palay_purchases SET status = 'completed'
    WHERE status = 'received'
      AND NOT EXISTS (
          SELECT 1 FROM palay_purchase_items i
          WHERE i.purchase_id = palay_purchases.id AND i.is_wet AND i.dried_weight_kg IS NULL
      )
    """,
    # The mill's list of by-products (byproduct_kinds, made by create_all) starts
    # with the ones it already has in stock, bought or sold, named as
    # byproduct_kind_service.name_for names them.
    """
    INSERT INTO byproduct_kinds (id, company_id, code, name, is_active)
    SELECT gen_random_uuid(), company_id, code,
           upper(left(replace(code, '_', ' '), 1)) || lower(substr(replace(code, '_', ' '), 2)), true
    FROM (
        SELECT company_id, byproduct_type AS code FROM byproduct_inventory
        UNION
        SELECT p.company_id, i.byproduct_type FROM byproduct_purchase_items i
        JOIN byproduct_purchases p ON p.id = i.purchase_id
        UNION
        SELECT o.company_id, i.byproduct_type FROM sales_order_items i
        JOIN sales_orders o ON o.id = i.order_id
    ) used
    WHERE company_id IS NOT NULL AND code IS NOT NULL AND code <> ''
      AND code NOT IN ('ipa', 'darak', 'binlid')
    ON CONFLICT (company_id, code) DO NOTHING
    """,
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
            seed_default_expense_categories(session, company.id)
            sync_system_varieties(session)
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
