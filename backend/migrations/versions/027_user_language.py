"""The language each account sees the web app in.

Chosen under Settings > Appearance and kept on the account, so it follows the
person to every device. NULL until they choose: the app then stays in the
language this device last showed, English at first.

Revision ID: 027_user_language
Revises: 026_plan_payment_qr
Create Date: 2026-10-27
"""

from __future__ import annotations

from alembic import op

revision = "027_user_language"
down_revision = "026_plan_payment_qr"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(16)")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS language")
