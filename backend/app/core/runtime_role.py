"""Refuse to run production code with more database power than it should have.

Shared by the API (at startup) and the jobs runner (before its first job):
both run as the DML-only runtime role and must never hold DDL, ownership or
admin rights, nor the right to rewrite the consent ledger.
"""

from __future__ import annotations

from sqlalchemy import Engine, text


def verify_runtime_database_role(engine: Engine, expected_role: str) -> None:
    """Raise RuntimeError unless ``engine`` connects as ``expected_role`` with DML only."""
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT current_user, r.rolsuper, r.rolcreatedb, r.rolcreaterole, "
                "r.rolreplication, r.rolbypassrls, "
                "has_database_privilege(current_user, current_database(), 'CREATE'), "
                "has_schema_privilege(current_user, 'public', 'CREATE'), "
                "EXISTS (SELECT 1 FROM pg_namespace n "
                "WHERE n.nspname ~ '^client_[a-f0-9]{32}$' "
                "AND has_schema_privilege(current_user, n.oid, 'CREATE')), "
                "EXISTS (SELECT 1 FROM pg_namespace n "
                "WHERE (n.nspname = 'public' OR n.nspname ~ '^client_[a-f0-9]{32}$') "
                "AND n.nspowner = r.oid), "
                "EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE (n.nspname = 'public' OR n.nspname ~ '^client_[a-f0-9]{32}$') "
                "AND c.relowner = r.oid) "
                "FROM pg_roles r WHERE r.rolname = current_user"
            )
        ).one()
        # The consent ledger is the evidence of who agreed to which terms: the
        # runtime role may add rows but never rewrite or delete them (migration
        # 007 and scripts/db_least_privilege.sql revoke both).
        ledger_writable = connection.execute(
            text(
                "SELECT COALESCE(bool_or(has_table_privilege(current_user, c.oid, 'UPDATE') "
                "OR has_table_privilege(current_user, c.oid, 'DELETE')), false) "
                "FROM pg_class c WHERE c.oid = to_regclass('public.legal_acceptances')"
            )
        ).scalar_one()
    if row[0] != expected_role:
        raise RuntimeError("DATABASE_URL authenticates as an unexpected role; use the configured DML-only runtime role")
    if any(row[1:]):
        raise RuntimeError(
            "The database role has administrative, ownership, or CREATE privileges; "
            "run tenant DDL only through PROVISIONER_DATABASE_URL"
        )
    if ledger_writable:
        raise RuntimeError(
            "The database role can UPDATE or DELETE legal_acceptances; the consent ledger "
            "must be append-only (run alembic upgrade head, then scripts/db_least_privilege.sql)"
        )
