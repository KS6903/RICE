"""Annual billing: an annual price per plan, and the interval a tenant asked for.

Adds ``subscription_plans.annual_price`` (admin-set, not auto-computed from the
monthly price, same as monthly_price already is) and
``subscription_upgrade_requests.billing_interval`` (what the tenant picked on the
Settings > Billing toggle when they filed the request). There is no payment
gateway in this app — plan changes are a manual admin-approval workflow — so the
interval is carried as intent for the admin to see, not wired into an automatic
billing cycle on ``subscriptions``.

Existing paid plans are backfilled at 10x the monthly price (two months free),
a conventional annual discount; Free stays 0.

Revision ID: 010_annual_billing
Revises: 009_automations_feature
Create Date: 2026-09-30
"""

from __future__ import annotations

from alembic import op

revision = "010_annual_billing"
down_revision = "009_automations_feature"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 builds these tables from today's
    # models, which already have both columns (the trap 008 documents).
    op.execute(
        "ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS annual_price NUMERIC(10, 2) NOT NULL DEFAULT 0"
    )
    op.execute(
        "UPDATE subscription_plans SET annual_price = monthly_price * 10 WHERE monthly_price > 0 AND annual_price = 0"
    )
    op.execute(
        "ALTER TABLE subscription_upgrade_requests "
        "ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(10) NOT NULL DEFAULT 'monthly'"
    )


def downgrade() -> None:
    op.drop_column("subscription_upgrade_requests", "billing_interval")
    op.drop_column("subscription_plans", "annual_price")
