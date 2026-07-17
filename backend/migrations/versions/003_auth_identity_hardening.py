"""Harden MFA replay tracking and Google identity binding.

Revision ID: 003_auth_identity_hardening
Revises: 002_drop_company_db_url
Create Date: 2026-07-11
"""
from __future__ import annotations

from alembic import op

revision = "003_auth_identity_hardening"
down_revision = "002_drop_company_db_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 001 creates from current metadata on fresh databases; guards keep this
    # historical upgrade compatible with both fresh installs and older schemas.
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_used_step BIGINT NULL"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_issuer VARCHAR(255) NULL"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255) NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_google_sub")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS google_sub")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS google_issuer")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS mfa_last_used_step")
