"""Retries for tenant provisioning: attempts so far, and when the next may run.

Before this, one failed attempt marked a tenant failed for good, and only
editing the database could bring it back. Tenants already marked failed
start at zero attempts, so the provisioner retries them once this is live.

Revision ID: 013_provisioning_retries
Revises: 012_auth_purge_grants
Create Date: 2026-10-03
"""

from __future__ import annotations

from alembic import op

revision = "013_provisioning_retries"
down_revision = "012_auth_purge_grants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built companies from the models.
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS provisioning_attempts INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS provisioning_next_attempt_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS provisioning_next_attempt_at")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS provisioning_attempts")
