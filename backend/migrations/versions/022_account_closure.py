"""The Boss can pause the mill's account, or ask for it to be deleted.

companies.is_active already locks a mill out. These say when the Boss closed it
(rather than Oraiza, from the admin console), who did, and when deletion was
asked for: the Terms' export window runs from then (core/account_status.py).

Revision ID: 022_account_closure
Revises: 021_custom_roles
Create Date: 2026-10-24
"""

from __future__ import annotations

from alembic import op

revision = "022_account_closure"
down_revision = "021_custom_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS closed_by UUID")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS deletion_requested_at")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS closed_by")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS closed_at")
