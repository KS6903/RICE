"""Grant the canva_inventory feature (the Inventory → Warehouse view) to Pro and Enterprise.

The Warehouse view and its API are gated on canva_inventory, but no migration
ever granted it: development databases had it on Pro and Enterprise by hand,
so a fresh database (the preview, production) showed every mill an upgrade
prompt instead. Plain SQL rather than the ORM model, as in 009, so a later
column on subscription_plans can't break this migration.

Revision ID: 016_canva_inventory_feature
Revises: 015_temporary_passwords
Create Date: 2026-10-09
"""

from __future__ import annotations

from alembic import op

revision = "016_canva_inventory_feature"
down_revision = "015_temporary_passwords"
branch_labels = None
depends_on = None

PLANS = "('pro', 'enterprise')"


def upgrade() -> None:
    op.execute(
        "UPDATE subscription_plans "
        "SET features = COALESCE(features, CAST('[]' AS jsonb)) || CAST('[\"canva_inventory\"]' AS jsonb) "
        f"WHERE code IN {PLANS} "
        "AND NOT jsonb_exists(COALESCE(features, CAST('[]' AS jsonb)), 'canva_inventory')"
    )


def downgrade() -> None:
    op.execute(f"UPDATE subscription_plans SET features = features - 'canva_inventory' WHERE code IN {PLANS}")
