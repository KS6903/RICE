"""Public (control-plane) baseline for schema-per-client multi-tenancy.

This is a fresh, collapsed baseline (the previous 23-file chain was retired when
RICE moved from shared-schema row isolation to schema-per-client). It builds ONLY
the shared ``public`` schema — identity + the control plane:

    companies, branches, users, roles, auth_sessions, password_reset_tokens,
    subscription_plans, subscriptions, subscription_upgrade_requests,
    byproduct_types, user_locations

Each client's domain tables live in their own ``client_<hex>`` schema and are NOT
created here — they're provisioned per client by ``app.core.tenancy.provision_tenant``
(and synced across existing clients by ``migrate_all_tenants.py``).

Tables are created straight from the ORM metadata (filtered to the public set) so
this baseline can never drift from the models. It also seeds the shared reference
data signup depends on: roles, subscription plans (incl. the Free plan), and the
global byproduct catalog.

Revision ID: 001_public_baseline
Revises:
Create Date: 2026-06-13
"""
from __future__ import annotations

import uuid

from alembic import op
from sqlalchemy.orm import Session

# Import the app so the full ORM metadata is registered on Base.metadata.
import app.models  # noqa: F401
from app.core.database import Base
from app.core.tenancy import public_tables

revision = "001_public_baseline"
down_revision = None
branch_labels = None
depends_on = None


ROLES = [
    (1, "owner"), (2, "admin"), (3, "mill_operator"),
    (4, "accountant"), (5, "cashier"), (6, "encoder"),
]

BYPRODUCTS = [(1, "ipa", "Ipa (Rice Hull)"), (2, "darak", "Darak (Rice Bran)"), (3, "binlid", "Binlid (Broken Rice)")]

# Final canonical plan set (free / basic / pro / enterprise).
PLANS = [
    {
        "code": "free", "name": "Free", "monthly_price": 0, "max_users": 3, "max_branches": 1, "sort_order": 1,
        "description": "Get started with core operations. Single branch, small team.",
        "features": ["dashboard", "paddy", "milling", "inventory", "sales", "expenses", "users"],
    },
    {
        "code": "basic", "name": "Basic", "monthly_price": 699, "max_users": 7, "max_branches": 2, "sort_order": 2,
        "description": "Step up from Free. Two branches and a slightly bigger team.",
        "features": ["dashboard", "paddy", "milling", "inventory", "sales", "expenses", "users", "multi_branch"],
    },
    {
        "code": "pro", "name": "Pro", "monthly_price": 1499, "max_users": 15, "max_branches": 5, "sort_order": 3,
        "description": "For growing rice mills. Multi-branch, employees, advanced reports.",
        "features": ["dashboard", "paddy", "milling", "inventory", "sales", "expenses", "users",
                     "employees", "multi_branch", "reports_advanced"],
    },
    {
        "code": "enterprise", "name": "Enterprise", "monthly_price": 4999, "max_users": None, "max_branches": None,
        "sort_order": 4,
        "description": "Full ERP. Compliance reports, offline sync, unlimited users and branches.",
        "features": ["dashboard", "paddy", "milling", "inventory", "sales", "expenses", "users",
                     "employees", "multi_branch", "reports_advanced", "compliance_reports", "offline_sync"],
    },
]


def upgrade() -> None:
    bind = op.get_bind()
    # Build the public-schema tables from the ORM models (cycle-safe: SQLAlchemy
    # adds the branches<->users FKs via ALTER after creating both).
    Base.metadata.create_all(bind=bind, tables=public_tables())

    from app.models.reference import ByproductType
    from app.models.subscription import SubscriptionPlan
    from app.models.user import Role

    session = Session(bind=bind)
    for role_id, name in ROLES:
        session.add(Role(id=role_id, name=name))
    for bp_id, bp_name, local in BYPRODUCTS:
        session.add(ByproductType(id=bp_id, name=bp_name, local_name=local))
    for p in PLANS:
        session.add(SubscriptionPlan(id=uuid.uuid4(), is_active=True, **p))
    session.flush()


def downgrade() -> None:
    bind = op.get_bind()
    # Reverse of a from-models baseline: drop the public tables we created.
    Base.metadata.drop_all(bind=bind, tables=list(reversed(public_tables())))
