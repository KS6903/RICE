"""Make the legal acceptance ledger append-only on every database.

006 creates legal_acceptances and then revokes UPDATE and DELETE from the
runtime role, but it returns early when the table already exists. On a fresh
database it always does, because 001 builds every table from the current
models. So on a new database, a new production one included, the REVOKE never
ran, and the runtime role (granted DML on all of public by
scripts/db_least_privilege.sql) could rewrite or delete the evidence of who
agreed to which terms.

This applies the REVOKE with no guard. REVOKE is idempotent, so databases where
006 did run are unaffected.

Revision ID: 007_legal_ledger_revoke
Revises: 006_legal_acceptance
Create Date: 2026-09-27
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "007_legal_ledger_revoke"
down_revision = "006_legal_acceptance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    # DO blocks take no bind parameters, so the role name is interpolated; the
    # regex above (the same one core/config.py enforces) makes that safe.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                REVOKE UPDATE, DELETE ON TABLE legal_acceptances FROM "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Deliberately a no-op: handing UPDATE/DELETE back would re-open the hole.
    pass
