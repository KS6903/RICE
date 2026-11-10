"""A bank transfer's details on the upgrade request: the bank or e-wallet it was
sent from, the reference on its receipt, and where the screenshot of it is kept
(services/payment_notices.py).

IF NOT EXISTS: on a fresh database 001 already built these from the models.

Revision ID: 036_payment_receipts
Revises: 035_bossadmin_security_vouchers
Create Date: 2026-11-10
"""

from __future__ import annotations

from alembic import op

revision = "036_payment_receipts"
down_revision = "035_bossadmin_security_vouchers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE subscription_upgrade_requests ADD COLUMN IF NOT EXISTS paid_from VARCHAR(100)")
    op.execute("ALTER TABLE subscription_upgrade_requests ADD COLUMN IF NOT EXISTS reference VARCHAR(100)")
    op.execute("ALTER TABLE subscription_upgrade_requests ADD COLUMN IF NOT EXISTS receipt_key VARCHAR(200)")


def downgrade() -> None:
    op.execute("ALTER TABLE subscription_upgrade_requests DROP COLUMN IF EXISTS receipt_key")
    op.execute("ALTER TABLE subscription_upgrade_requests DROP COLUMN IF EXISTS reference")
    op.execute("ALTER TABLE subscription_upgrade_requests DROP COLUMN IF EXISTS paid_from")
