"""Add deactivated_at to agents and millers.

Revision ID: 014_operator_deactivated_at
Revises: 013_layout_trash
Create Date: 2026-06-09

Tracks when an operator was deactivated so the frontend can sort the
deactivated-operators tab from latest to oldest.
"""
from alembic import op
import sqlalchemy as sa

revision = "014_operator_deactivated_at"
down_revision = "013_layout_trash"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agents", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("millers", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("agents", "deactivated_at")
    op.drop_column("millers", "deactivated_at")
