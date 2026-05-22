"""Rename the top-tier plan code/name from 'enhance' to 'enterprise'.

Revision ID: 009_rename_enhance_to_enterprise
Revises: 008_plan_tiers_basic_enhance
Create Date: 2026-05-21

Why: "Enhance" is an unusual name for a SaaS tier (it's a verb); "Enterprise"
is the industry-standard label for the top tier and reads more professionally.

This only updates `code` and `name` on subscription_plans. Existing rows in
subscriptions and upgrade_requests reference plans by UUID, so all in-flight
data continues to point at the same row — the relationship is unchanged.
"""
from alembic import op
import sqlalchemy as sa


revision = "009_rename_enhance_to_enterprise"
down_revision = "008_plan_tiers_basic_enhance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE subscription_plans "
        "SET code = 'enterprise', name = 'Enterprise' "
        "WHERE code = 'enhance'"
    ))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE subscription_plans "
        "SET code = 'enhance', name = 'Enhance' "
        "WHERE code = 'enterprise'"
    ))
