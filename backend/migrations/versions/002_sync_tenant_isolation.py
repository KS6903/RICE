"""Add company_id to sync_log and sync_conflicts for tenant isolation.

Revision ID: 002_sync_tenant
Revises: 001_initial
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "002_sync_tenant"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sync_log",
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_sync_log_company_id", "sync_log", ["company_id"])

    op.add_column(
        "sync_conflicts",
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_sync_conflicts_company_id", "sync_conflicts", ["company_id"])


def downgrade() -> None:
    op.drop_index("ix_sync_conflicts_company_id", table_name="sync_conflicts")
    op.drop_column("sync_conflicts", "company_id")
    op.drop_index("ix_sync_log_company_id", table_name="sync_log")
    op.drop_column("sync_log", "company_id")
