"""Subscription plans + per-tenant subscriptions. Seeds Free/Pro/Enterprise; assigns Free to all existing tenants.

Revision ID: 006_subscriptions
Revises: 005_employees
Create Date: 2026-05-03
"""
import uuid
import json
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "006_subscriptions"
down_revision = "005_employees"
branch_labels = None
depends_on = None


PLANS = [
    {
        "code": "free",
        "name": "Free",
        "description": "Get started with core operations. Single branch, small team.",
        "monthly_price": 0,
        "max_users": 3,
        "max_branches": 1,
        "features": ["dashboard", "paddy", "milling", "inventory", "sales", "expenses", "users"],
        "sort_order": 1,
    },
    {
        "code": "pro",
        "name": "Pro",
        "description": "For growing rice mills. Multi-branch, employees, advanced reports.",
        "monthly_price": 1499,
        "max_users": 15,
        "max_branches": 5,
        "features": ["dashboard", "paddy", "milling", "inventory", "sales", "expenses", "users",
                     "employees", "multi_branch", "reports_advanced"],
        "sort_order": 2,
    },
    {
        "code": "enterprise",
        "name": "Enterprise",
        "description": "Full ERP. Compliance reports, offline sync, unlimited users and branches.",
        "monthly_price": 4999,
        "max_users": None,
        "max_branches": None,
        "features": ["dashboard", "paddy", "milling", "inventory", "sales", "expenses", "users",
                     "employees", "multi_branch", "reports_advanced", "compliance_reports", "offline_sync"],
        "sort_order": 3,
    },
]


def upgrade() -> None:
    op.create_table(
        "subscription_plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(30), unique=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("monthly_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("max_users", sa.Integer(), nullable=True),
        sa.Column("max_branches", sa.Integer(), nullable=True),
        sa.Column("features", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("subscription_plans.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )

    # Seed plans
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
    free_plan_id = uuid.uuid4()
    seed_rows = []
    for i, p in enumerate(PLANS):
        pid = free_plan_id if p["code"] == "free" else uuid.uuid4()
        seed_rows.append({
            "id": pid,
            "code": p["code"],
            "name": p["name"],
            "description": p["description"],
            "monthly_price": p["monthly_price"],
            "max_users": p["max_users"],
            "max_branches": p["max_branches"],
            "features": p["features"],
            "is_active": True,
            "sort_order": p["sort_order"],
        })
    op.bulk_insert(plans_table, seed_rows)

    # Assign Free plan to all existing tenants
    bind = op.get_bind()
    bind.execute(sa.text(f"""
        INSERT INTO subscriptions (id, company_id, plan_id, status, started_at)
        SELECT gen_random_uuid(), c.id, '{free_plan_id}', 'active', NOW()
        FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id)
    """))


def downgrade() -> None:
    op.drop_table("subscriptions")
    op.drop_table("subscription_plans")
