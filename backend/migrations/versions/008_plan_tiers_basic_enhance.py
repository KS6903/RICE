"""Plan tiers update: rename Enterprise -> Enhance; insert Basic plan between Free and Pro.

Revision ID: 008_plan_tiers_basic_enhance
Revises: 007_upgrade_requests
Create Date: 2026-05-20
"""
import uuid
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "008_plan_tiers_basic_enhance"
down_revision = "007_upgrade_requests"
branch_labels = None
depends_on = None


BASIC_FEATURES = [
    "dashboard", "paddy", "milling", "inventory",
    "sales", "expenses", "users", "multi_branch",
]


def upgrade() -> None:
    bind = op.get_bind()

    # Rename Enterprise -> Enhance in place (existing subscriptions keep the same plan_id).
    bind.execute(sa.text(
        "UPDATE subscription_plans "
        "SET code = 'enhance', name = 'Enhance', "
        "    description = :desc "
        "WHERE code = 'enterprise'"
    ).bindparams(desc="Full ERP. Compliance reports, offline sync, unlimited users and branches."))

    # Re-number sort_order so Basic can sit at position 2.
    bind.execute(sa.text("UPDATE subscription_plans SET sort_order = 3 WHERE code = 'pro'"))
    bind.execute(sa.text("UPDATE subscription_plans SET sort_order = 4 WHERE code = 'enhance'"))

    # Insert Basic plan if it doesn't already exist.
    existing = bind.execute(sa.text("SELECT id FROM subscription_plans WHERE code = 'basic'")).first()
    if not existing:
        plans_table = sa.table(
            "subscription_plans",
            sa.column("id", UUID(as_uuid=True)),
            sa.column("code", sa.String),
            sa.column("name", sa.String),
            sa.column("description", sa.Text),
            sa.column("monthly_price", sa.Numeric),
            sa.column("max_users", sa.Integer),
            sa.column("max_branches", sa.Integer),
            sa.column("features", JSONB),
            sa.column("is_active", sa.Boolean),
            sa.column("sort_order", sa.Integer),
        )
        op.bulk_insert(plans_table, [{
            "id": uuid.uuid4(),
            "code": "basic",
            "name": "Basic",
            "description": "Step up from Free. Two branches and a slightly bigger team.",
            "monthly_price": 699,
            "max_users": 7,
            "max_branches": 2,
            "features": BASIC_FEATURES,
            "is_active": True,
            "sort_order": 2,
        }])


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM subscription_plans WHERE code = 'basic'"))
    bind.execute(sa.text(
        "UPDATE subscription_plans "
        "SET code = 'enterprise', name = 'Enterprise', "
        "    description = :desc "
        "WHERE code = 'enhance'"
    ).bindparams(desc="Full ERP. Compliance reports, offline sync, unlimited users and branches."))
    bind.execute(sa.text("UPDATE subscription_plans SET sort_order = 2 WHERE code = 'pro'"))
    bind.execute(sa.text("UPDATE subscription_plans SET sort_order = 3 WHERE code = 'enterprise'"))
