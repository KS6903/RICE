"""Add deactivated_by_id to agents and millers.

Revision ID: 015_operator_deactivated_by
Revises: 014_operator_deactivated_at
Create Date: 2026-06-09

Tracks which user deactivated an operator so the deactivated-operators
tab can show "Deactivated by <full_name>".
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "015_operator_deactivated_by"
down_revision = "014_operator_deactivated_at"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agents", sa.Column("deactivated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("millers", sa.Column("deactivated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))


def downgrade():
    op.drop_column("agents", "deactivated_by_id")
    op.drop_column("millers", "deactivated_by_id")
