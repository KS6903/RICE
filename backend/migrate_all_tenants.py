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

from sqlalchemy import text

from app.core.database import Base, SessionLocal
from app.core.tenancy import schema_name_for, set_search_path, tenant_tables
from app.models.company import Company

# One-off ALTERs to apply inside each client schema (e.g. "ALTER TABLE sales_orders
# ADD COLUMN IF NOT EXISTS …"). Keep idempotent. Empty in normal operation.
_extra_ddl: list[str] = []


def migrate_all() -> None:
    db = SessionLocal()
    try:
        companies = db.query(Company).all()
    finally:
        db.close()

    print(f"Syncing {len(companies)} client schema(s)…")
    for company in companies:
        schema = schema_name_for(company)
        session = SessionLocal()
        try:
            set_search_path(session, schema)
            Base.metadata.create_all(bind=session.connection(), tables=tenant_tables())
            for stmt in _extra_ddl:
                session.execute(text(stmt))
            session.commit()
            print(f"  ✓ {schema} ({company.name})")
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            print(f"  ✗ {schema} ({company.name}): {exc}")
        finally:
            session.close()
    print("Done.")


if __name__ == "__main__":
    migrate_all()
