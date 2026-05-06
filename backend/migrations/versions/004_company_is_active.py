"""Add is_active to companies for tenant-level enable/disable.

Revision ID: 004_company_active
Revises: 003_platform_admin
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa

revision = "004_company_active"
down_revision = "003_platform_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("companies", "is_active")
