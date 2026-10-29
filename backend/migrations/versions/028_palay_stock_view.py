"""How the Palay page counts the palay in stock.

The Boss picks sacks, cavans, kilos or all three, once for the whole mill. NULL
until chosen, which shows all three.

Revision ID: 028_palay_stock_view
Revises: 027_user_language
Create Date: 2026-10-29
"""

from __future__ import annotations

from alembic import op

revision = "028_palay_stock_view"
down_revision = "027_user_language"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS palay_stock_view VARCHAR(10)")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS palay_stock_view")
