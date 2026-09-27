"""The runtime role must never be able to rewrite or delete consent evidence."""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

_MIGRATION = Path(__file__).resolve().parents[2] / "migrations" / "versions" / "007_legal_ledger_revoke.py"


def _migration_007():
    spec = importlib.util.spec_from_file_location("migration_007", _MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def connection():
    # One transaction, rolled back at the end, throwaway role included: CREATE
    # ROLE is transactional in PostgreSQL, so nothing outlives the test.
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            yield conn
        finally:
            transaction.rollback()


def _has(conn, role: str, privilege: str) -> bool:
    return conn.execute(
        text("SELECT has_table_privilege(:role, 'public.legal_acceptances', :privilege)"),
        {"role": role, "privilege": privilege},
    ).scalar_one()


def test_migration_007_revokes_rewrite_rights_where_006_skipped_it(connection, monkeypatch):
    role = f"oryza_test_{uuid.uuid4().hex[:12]}"
    connection.execute(text(f'CREATE ROLE "{role}" NOLOGIN'))
    # A fresh database: the table exists before 006 runs, so 006 returned early,
    # and db_least_privilege.sql had granted the runtime role full DML.
    connection.execute(text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_acceptances TO "{role}"'))
    assert _has(connection, role, "UPDATE") and _has(connection, role, "DELETE")

    monkeypatch.setattr(settings, "RUNTIME_DATABASE_ROLE", role)
    with Operations.context(MigrationContext.configure(connection)):
        _migration_007().upgrade()

    assert not _has(connection, role, "UPDATE")
    assert not _has(connection, role, "DELETE")
    # Recording new acceptances still works.
    assert _has(connection, role, "INSERT") and _has(connection, role, "SELECT")


def test_migration_007_is_safe_where_the_role_does_not_exist(connection, monkeypatch):
    # Dev and CI databases have no runtime role; the migration must not fail there.
    monkeypatch.setattr(settings, "RUNTIME_DATABASE_ROLE", f"oryza_absent_{uuid.uuid4().hex[:12]}")
    with Operations.context(MigrationContext.configure(connection)):
        _migration_007().upgrade()


def test_migration_007_refuses_an_unsafe_role_name(connection, monkeypatch):
    monkeypatch.setattr(settings, "RUNTIME_DATABASE_ROLE", 'app"; DROP TABLE users; --')
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(ValueError, match="Unsafe RUNTIME_DATABASE_ROLE"):
            _migration_007().upgrade()
