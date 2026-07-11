"""Harden MFA replay tracking and Google identity binding.

Revision ID: 003_auth_identity_hardening
Revises: 002_drop_company_db_url
Create Date: 2026-07-11
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "003_auth_identity_hardening"
down_revision = "002_drop_company_db_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_last_used_step", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("google_issuer", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("google_sub", sa.String(length=255), nullable=True))
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_column("users", "google_sub")
    op.drop_column("users", "google_issuer")
    op.drop_column("users", "mfa_last_used_step")
