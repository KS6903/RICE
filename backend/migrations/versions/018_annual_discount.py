"""Annual price from a discount: the platform console no longer types it in.

Adds ``subscription_plans.annual_discount_percent``, what a yearly subscriber
saves off 12 months of the monthly price. From now on the API works the annual
price out from the monthly price and this discount (to the nearest peso), so
the two can't disagree.

Each existing plan gets the discount its current annual price already gives:
the 010 backfill of 10x monthly ("two months free") becomes 16.6667%, which
lands back on the same price. A plan with no annual price (0) gets no discount,
so its annual price becomes 12 months, which is what tenants were already shown
for it. A plan priced above 12 months gets 0% and comes down to 12 months.
Plain SQL, as in 017, so a later column on the plans can't break this.

Revision ID: 018_annual_discount
Revises: 017_role_access
Create Date: 2026-10-21
"""

from __future__ import annotations

from alembic import op

revision = "018_annual_discount"
down_revision = "017_role_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 builds the table from today's
    # model, which already has the column.
    op.execute(
        "ALTER TABLE subscription_plans "
        "ADD COLUMN IF NOT EXISTS annual_discount_percent NUMERIC(7, 4) NOT NULL DEFAULT 0"
    )
    op.execute(
        "UPDATE subscription_plans SET annual_discount_percent = "
        "LEAST(GREATEST(ROUND(100 * (1 - annual_price / (monthly_price * 12)), 4), 0), 99.9999) "
        "WHERE monthly_price > 0 AND annual_price > 0 AND annual_discount_percent = 0"
    )
    # The same sum as app.services.subscription.annual_price.
    op.execute(
        "UPDATE subscription_plans SET annual_price = "
        "ROUND(COALESCE(monthly_price, 0) * 12 * (100 - annual_discount_percent) / 100, 0)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS annual_discount_percent")
