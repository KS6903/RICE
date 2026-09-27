"""Scheduled-job claims: job_runs.

The jobs runner (app/jobs) records every run here before doing the work. A
unique index on (job, company_id, run_key) makes a second claim of the same run
a no-op, so a job never runs twice even if two runners overlap. NULLS NOT
DISTINCT (PostgreSQL 15+) extends that to platform runs, which have no company.

On a fresh database 001 has already built this table from the models, so the
table and its index are created only if missing. The GRANT, however, runs
unconditionally (006's early return is the bug migration 007 had to fix).
Migrations run as the provisioner role, and the default privileges set by
db_least_privilege.sql cover only tables created by whoever ran that script,
so the runtime role needs an explicit grant.

Revision ID: 008_job_runs
Revises: 007_legal_ledger_revoke
Create Date: 2026-09-27
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "008_job_runs"
down_revision = "007_legal_ledger_revoke"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS job_runs (
            id UUID PRIMARY KEY,
            job VARCHAR(64) NOT NULL,
            company_id UUID NULL REFERENCES companies (id) ON DELETE CASCADE,
            run_key VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL,
            attempts SMALLINT NOT NULL DEFAULT 1,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            finished_at TIMESTAMPTZ NULL,
            detail TEXT NULL
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_job_runs_job_company_run_key "
        "ON job_runs (job, company_id, run_key) NULLS NOT DISTINCT"
    )

    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    # DO blocks take no bind parameters; the regex above makes the name safe.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                GRANT SELECT, INSERT, UPDATE ON TABLE job_runs TO "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS job_runs")
