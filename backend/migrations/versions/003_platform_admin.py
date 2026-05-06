"""Add is_platform_admin column to users for SaaS owner accounts.

Revision ID: 003_platform_admin
Revises: 002_sync_tenant
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa

revision = "003_platform_admin"
down_revision = "002_sync_tenant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_platform_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_users_is_platform_admin", "users", ["is_platform_admin"])


def downgrade() -> None:
    op.drop_index("ix_users_is_platform_admin", table_name="users")
    op.drop_column("users", "is_platform_admin")
