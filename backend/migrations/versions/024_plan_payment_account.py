"""Where a mill pays for each plan.

The checkout page (web: pages/CheckoutPage.tsx) shows the bank account a mill
sends the plan's price to. Each plan has its own, edited by BossAdmin, and the
numbers live in the database so they stay out of the public repo.

Revision ID: 024_plan_payment_account
Revises: 023_branch_view
Create Date: 2026-10-25
"""

from __future__ import annotations

from alembic import op

revision = "024_plan_payment_account"
down_revision = "023_branch_view"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS payment_bank VARCHAR(100)")
    op.execute("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS payment_account_name VARCHAR(150)")
    op.execute("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS payment_account_number VARCHAR(50)")


def downgrade() -> None:
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS payment_account_number")
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS payment_account_name")
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS payment_bank")
