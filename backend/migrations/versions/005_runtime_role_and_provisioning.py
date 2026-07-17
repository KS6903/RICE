"""Track tenant provisioning for split runtime/provisioner credentials.

Revision ID: 005_runtime_provisioning
Revises: 004_drying_advisor_feature
Create Date: 2026-07-16
"""
from __future__ import annotations

from alembic import op

revision = "005_runtime_provisioning"
down_revision = "004_drying_advisor_feature"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The baseline migration builds from current ORM metadata for a brand-new
    # database, so these guards support both fresh installs and upgrades.
    op.execute(
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS "
        "provisioning_requested_at TIMESTAMPTZ NULL"
    )
    op.execute(
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ NULL"
    )
    op.execute(
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS provisioning_error VARCHAR(120) NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_companies_provisioning_queue "
        "ON companies (provisioning_requested_at) "
        "WHERE provisioned_at IS NULL AND provisioning_requested_at IS NOT NULL"
    )
    # Existing companies already have schemas; only newly-created companies
    # need the explicit provisioning workflow.
    op.execute("UPDATE companies SET provisioned_at = now() WHERE provisioned_at IS NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_companies_provisioning_queue")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS provisioning_error")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS provisioned_at")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS provisioning_requested_at")
