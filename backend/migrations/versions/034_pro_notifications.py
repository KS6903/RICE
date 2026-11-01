"""Most notifications move to Pro. A new feature code, ``notifications``, opens the
Automations page and the rule-based alerts; ``automations`` stays Enterprise's and now
means the rest: the AI recipes, credit limit blocking, scheduled reports, month in review,
stock count, machine servicing, and alerts that become To do tasks.

Revision ID: 034_pro_notifications
Revises: 033_app_feedback
Create Date: 2026-11-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "034_pro_notifications"
down_revision = "033_app_feedback"
branch_labels = None
depends_on = None

CODE = "notifications"
PLANS = ("pro", "enterprise")
PRO_DESCRIPTION = (
    "Adds field operators, cash count, collections, employees, advanced reports, "
    "notifications, a To do list on the Palay page and the Profit calculator."
)
OLD_PRO_DESCRIPTION = (
    "Adds field operators, cash count, collections, employees, advanced reports, "
    "a To do list on the Palay page and the Profit calculator."
)
ENTERPRISE_DESCRIPTION = (
    "Everything, plus AI advice, credit limit blocking, scheduled reports, To do, "
    "stock count, machine servicing, compliance reports and offline sync."
)
OLD_ENTERPRISE_DESCRIPTION = "Everything, plus automations, compliance reports and offline sync."


def _run(sql: str, **params: object) -> None:
    op.execute(sa.text(sql).bindparams(**params))


def _describe(plan: str, text: str, old: str) -> None:
    _run(
        "UPDATE subscription_plans SET description = :text WHERE code = :plan AND description = :old",
        text=text,
        plan=plan,
        old=old,
    )


def upgrade() -> None:
    for plan in PLANS:
        _run(
            "UPDATE subscription_plans "
            "SET features = COALESCE(features, CAST('[]' AS jsonb)) || jsonb_build_array(CAST(:code AS text)) "
            "WHERE code = :plan AND NOT jsonb_exists(COALESCE(features, CAST('[]' AS jsonb)), :code)",
            plan=plan,
            code=CODE,
        )
    _describe("pro", PRO_DESCRIPTION, OLD_PRO_DESCRIPTION)
    _describe("enterprise", ENTERPRISE_DESCRIPTION, OLD_ENTERPRISE_DESCRIPTION)


def downgrade() -> None:
    _run("UPDATE subscription_plans SET features = features - :code WHERE code IN ('pro', 'enterprise')", code=CODE)
    _describe("pro", OLD_PRO_DESCRIPTION, PRO_DESCRIPTION)
    _describe("enterprise", OLD_ENTERPRISE_DESCRIPTION, ENTERPRISE_DESCRIPTION)
