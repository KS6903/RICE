"""Let the runtime role delete old job_runs rows.

The job_runs.prune job keeps a month of run history: every-tick jobs and
recipes claim a row per tenant per tick, about a hundred a day each, and
nothing else ever removes them. 008 granted SELECT, INSERT and UPDATE only.

Revision ID: 011_job_runs_prune
Revises: 010_annual_billing
Create Date: 2026-10-02
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "011_job_runs_prune"
down_revision = "010_annual_billing"
branch_labels = None
depends_on = None


def _role() -> str:
    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    return role


def upgrade() -> None:
    role = _role()
    # DO blocks take no bind parameters; _role() makes the name safe.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                GRANT DELETE ON TABLE job_runs TO "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    role = _role()
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                REVOKE DELETE ON TABLE job_runs FROM "{role}";
            END IF;
        END $$;
        """
    )
