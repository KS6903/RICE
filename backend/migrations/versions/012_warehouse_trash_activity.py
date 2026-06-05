"""Warehouse soft-delete (30-day trash) and per-user activity log.

Revision ID: 012_warehouse_trash_activity
Revises: 011_warehouse_canva
Create Date: 2026-06-03

- branches: add deleted_at / deleted_by so warehouses can be moved to a
  recoverable trash instead of being destroyed immediately.
- activity_logs: append-only audit trail of notable actions (warehouse
  delete/restore/purge), surfaced in company Settings and platform admin.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "012_warehouse_trash_activity"
down_revision = "011_warehouse_canva"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("branches", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("branches", sa.Column("deleted_by", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_branches_deleted_by_users", "branches", "users",
        ["deleted_by"], ["id"], ondelete="SET NULL",
    )

    op.create_table(
        "activity_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("entity_type", sa.String(40), nullable=False),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=True),
        sa.Column("entity_label", sa.String(200), nullable=True),
        sa.Column("detail", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_activity_logs_company_created", "activity_logs", ["company_id", "created_at"])


def downgrade():
    op.drop_index("ix_activity_logs_company_created", table_name="activity_logs")
    op.drop_table("activity_logs")
    op.drop_constraint("fk_branches_deleted_by_users", "branches", type_="foreignkey")
    op.drop_column("branches", "deleted_by")
    op.drop_column("branches", "deleted_at")
