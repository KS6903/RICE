"""Subscription upgrade requests — tenants ask, admins approve/reject.

Revision ID: 007_upgrade_requests
Revises: 006_subscriptions
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "007_upgrade_requests"
down_revision = "006_subscriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscription_upgrade_requests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_plan_id", UUID(as_uuid=True), sa.ForeignKey("subscription_plans.id"), nullable=False),
        sa.Column("current_plan_id", UUID(as_uuid=True), sa.ForeignKey("subscription_plans.id"), nullable=True),
        sa.Column("requested_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("ix_upgrade_requests_company_status", "subscription_upgrade_requests", ["company_id", "status"])
    op.create_index("ix_upgrade_requests_status", "subscription_upgrade_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_upgrade_requests_status", table_name="subscription_upgrade_requests")
    op.drop_index("ix_upgrade_requests_company_status", table_name="subscription_upgrade_requests")
    op.drop_table("subscription_upgrade_requests")
