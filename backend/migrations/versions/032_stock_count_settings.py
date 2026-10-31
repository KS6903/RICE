"""How the Stock count page counts, on the shared companies table.

The branch a count was of is inside each client's schema: ``_extra_ddl`` in
migrate_all_tenants.py. Nothing existing changes: NULL settings are sacks of 50 kg,
and older counts have no branch.

Revision ID: 032_stock_count_settings
Revises: 031_savings
Create Date: 2026-10-31
"""

from __future__ import annotations

from alembic import op

revision = "032_stock_count_settings"
down_revision = "031_savings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS stock_count_settings JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS stock_count_settings")
