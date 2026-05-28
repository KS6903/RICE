"""Add request_type to upgrade_requests and queued_plan_id to subscriptions.

Revision ID: 010_plan_change_queue
Revises: 009_rename_enhance_to_enterprise
Create Date: 2026-05-27

Why: tenants on active paid plans who want to switch plans should not have
their plan changed immediately on admin approval. Instead the new plan is
queued and applied automatically when their current subscription expires.

Changes:
  - subscription_upgrade_requests.request_type  VARCHAR(20) DEFAULT 'upgrade'
  - subscriptions.queued_plan_id                UUID FK → subscription_plans (nullable)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "010_plan_change_queue"
down_revision = "009_rename_enhance_to_enterprise"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "subscription_upgrade_requests",
        sa.Column("request_type", sa.String(20), nullable=False, server_default="upgrade"),
    )
    op.add_column(
        "subscriptions",
        sa.Column(
            "queued_plan_id",
            UUID(as_uuid=True),
            sa.ForeignKey("subscription_plans.id"),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("subscriptions", "queued_plan_id")
    op.drop_column("subscription_upgrade_requests", "request_type")
