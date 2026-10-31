"""The Savings page's settings, on the shared companies table.

Everything else the page adds is inside each client's schema: new tables come from
the models, and new columns from ``_extra_ddl`` in migrate_all_tenants.py. Nothing
existing changes: NULL settings are the defaults in services/savings_formulas.py.

Revision ID: 031_savings
Revises: 030_profit_calculator
Create Date: 2026-10-31
"""

from __future__ import annotations

from alembic import op

revision = "031_savings"
down_revision = "030_profit_calculator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS savings_settings JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS savings_settings")
