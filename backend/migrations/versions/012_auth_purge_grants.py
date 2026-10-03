"""Let the runtime role delete spent sign-in records.

The auth.purge_expired job deletes password-reset tokens past use and
sessions a month past expiry. db_least_privilege.sql grants DELETE on every
public table that exists when it runs, so this only matters if it ran before
these tables did; granting again is harmless.

Revision ID: 012_auth_purge_grants
Revises: 011_job_runs_prune
Create Date: 2026-10-03
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "012_auth_purge_grants"
down_revision = "011_job_runs_prune"
branch_labels = None
depends_on = None

_TABLES = ("password_reset_tokens", "auth_sessions")


def _role() -> str:
    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    return role


def _for_each_table(statement: str) -> None:
    role = _role()
    # DO blocks take no bind parameters; _role() makes the name safe.
    body = "\n".join(statement.format(table=table, role=role) for table in _TABLES)
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                {body}
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    _for_each_table('GRANT DELETE ON TABLE {table} TO "{role}";')


def downgrade() -> None:
    # 001 and db_least_privilege.sql may have granted DELETE already; leave it.
    pass
