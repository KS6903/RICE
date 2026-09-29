"""Grant the automations feature to the Enterprise plan only.

Tenant automations (scheduled reports, owner alerts, reminders) are an
Enterprise feature. Written in plain SQL rather than through the ORM model,
so a later column on subscription_plans can't break this migration.

Revision ID: 009_automations_feature
Revises: 008_job_runs
Create Date: 2026-09-29
"""

from __future__ import annotations

from alembic import op

revision = "009_automations_feature"
down_revision = "008_job_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE subscription_plans "
        "SET features = COALESCE(features, CAST('[]' AS jsonb)) || CAST('[\"automations\"]' AS jsonb) "
        "WHERE code = 'enterprise' AND NOT jsonb_exists(COALESCE(features, CAST('[]' AS jsonb)), 'automations')"
    )


def downgrade() -> None:
    op.execute("UPDATE subscription_plans SET features = features - 'automations' WHERE code = 'enterprise'")
