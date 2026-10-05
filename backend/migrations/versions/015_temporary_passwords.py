"""Temporary passwords: for someone locked out, from their Boss or the platform admin.

A temporary password replaces the real one, unlocks the account and signs the
person out everywhere. They must choose their own at first sign-in
(must_change_password blocks the app until they do), and the temporary one stops
working at temp_password_expires_at.

Revision ID: 015_temporary_passwords
Revises: 014_mfa_epoch
Create Date: 2026-10-04
"""

from __future__ import annotations

from alembic import op

revision = "015_temporary_passwords"
down_revision = "014_mfa_epoch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built users from the models.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS temp_password_expires_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS must_change_password")
