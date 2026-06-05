"""Layout soft-delete (30-day trash).

Revision ID: 013_layout_trash
Revises: 012_warehouse_trash_activity
Create Date: 2026-06-04

Adds deleted_at / deleted_by to warehouse_layouts so layouts can be moved to
a recoverable trash instead of being hard-deleted immediately.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "013_layout_trash"
down_revision = "012_warehouse_trash_activity"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("warehouse_layouts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("warehouse_layouts", sa.Column("deleted_by", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_warehouse_layouts_deleted_by_users", "warehouse_layouts", "users",
        ["deleted_by"], ["id"], ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_warehouse_layouts_deleted_by_users", "warehouse_layouts", type_="foreignkey")
    op.drop_column("warehouse_layouts", "deleted_by")
    op.drop_column("warehouse_layouts", "deleted_at")
