"""Let a mill's Boss change what each staff role can open.

Adds companies.role_access: the changes made to the default role/page matrix,
as {role: {page: level}}, only where they differ from the default. NULL means
the defaults apply. Plain SQL rather than the ORM model, as in 009 and 016, so a
later column on companies can't break this migration.

Revision ID: 017_role_access
Revises: 016_canva_inventory_feature
Create Date: 2026-10-13
"""

from __future__ import annotations

from alembic import op

revision = "017_role_access"
down_revision = "016_canva_inventory_feature"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS role_access JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS role_access")
