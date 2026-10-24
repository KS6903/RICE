"""Let a mill's Boss make up roles of their own, each with the pages it can open.

Adds company_roles (one mill's role: a name, and its level on every page) and
users.custom_role_id (someone holding one of those instead of a built-in role).
Deleting a role that still has people is refused (ON DELETE RESTRICT); deleting
the mill takes its roles with it. Plain SQL rather than the ORM model, as in 008
and 017, so a later column can't break this migration.

Revision ID: 021_custom_roles
Revises: 020_session_details
Create Date: 2026-10-24
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "021_custom_roles"
down_revision = "020_session_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS company_roles (
            id UUID PRIMARY KEY,
            company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
            name VARCHAR(50) NOT NULL,
            access JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_company_roles_company_name ON company_roles (company_id, name)")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID "
        "REFERENCES company_roles (id) ON DELETE RESTRICT"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_custom_role_id ON users (custom_role_id)")

    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    # DO blocks take no bind parameters; the regex above makes the name safe.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE company_roles TO "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_custom_role_id")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS custom_role_id")
    op.execute("DROP TABLE IF EXISTS company_roles")
