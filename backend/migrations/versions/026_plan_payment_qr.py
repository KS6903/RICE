"""A QR code for each plan's payment account.

subscription_plans.payment_qr_key names the picture BossAdmin uploads (kept in
Cloudflare R2, core/media_store.py), which the checkout page shows so a mill can
scan it with its bank or e-wallet app.

Revision ID: 026_plan_payment_qr
Revises: 025_plan_payments
Create Date: 2026-10-25
"""

from __future__ import annotations

from alembic import op

revision = "026_plan_payment_qr"
down_revision = "025_plan_payments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS payment_qr_key VARCHAR(200)")


def downgrade() -> None:
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS payment_qr_key")
