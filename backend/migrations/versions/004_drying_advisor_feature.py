"""Grant the drying_advisor feature to the Enterprise plan only.

Revision ID: 004_drying_advisor_feature
Revises: 003_auth_identity_hardening
Create Date: 2026-07-12
"""
from __future__ import annotations

from alembic import op
from sqlalchemy.orm import Session

revision = "004_drying_advisor_feature"
down_revision = "003_auth_identity_hardening"
branch_labels = None
depends_on = None

FEATURE = "drying_advisor"
PLAN_CODE = "enterprise"


def upgrade() -> None:
    from app.models.subscription import SubscriptionPlan

    session = Session(bind=op.get_bind())
    plan = session.query(SubscriptionPlan).filter_by(code=PLAN_CODE).first()
    if plan is not None and FEATURE not in (plan.features or []):
        plan.features = [*(plan.features or []), FEATURE]
        session.commit()


def downgrade() -> None:
    from app.models.subscription import SubscriptionPlan

    session = Session(bind=op.get_bind())
    plan = session.query(SubscriptionPlan).filter_by(code=PLAN_CODE).first()
    if plan is not None and FEATURE in (plan.features or []):
        plan.features = [f for f in plan.features if f != FEATURE]
        session.commit()
