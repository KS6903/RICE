"""Turning MFA off keeps the earlier authenticator, so remembered devices need a counter.

Turning MFA off used to wipe the secret, which also made every "remember this
device" token useless. Now the earlier secret is kept, so the owner can switch MFA
back on with it; mfa_epoch changes on every off and on, and those tokens are
bound to it, so a device remembered before the change is still asked again.

Revision ID: 014_mfa_epoch
Revises: 013_provisioning_retries
Create Date: 2026-10-04
"""

from __future__ import annotations

from alembic import op

revision = "014_mfa_epoch"
down_revision = "013_provisioning_retries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built users from the models.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_epoch INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS mfa_epoch")
