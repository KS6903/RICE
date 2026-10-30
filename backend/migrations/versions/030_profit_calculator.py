"""The Profit calculator page, for Pro plans and up.

A `profit` feature code: Pro and Enterprise get it, Free and Basic don't. Two
company settings go with it, both the Boss's: the margin the recommended selling
price aims for, and how much of the real profit staff are shown. NULL until
changed, which is 10% and 30% (services/profit_service.py).

Plain SQL, as in 019 and 029. Only adds the code to a plan that lacks it, so
running it on a plan an admin already edited does no harm.

Revision ID: 030_profit_calculator
Revises: 029_page_todo
Create Date: 2026-10-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "030_profit_calculator"
down_revision = "029_page_todo"
branch_labels = None
depends_on = None

CODE = "profit"
PLANS = ("pro", "enterprise")

PRO_DESCRIPTION = (
    "Adds field operators, cash count, collections, employees, advanced reports, "
    "a To do list on the Palay page and the Profit calculator."
)
# As 029 wrote it, for downgrade.
OLD_PRO_DESCRIPTION = (
    "Adds field operators, cash count, collections, employees, advanced reports and a To do list on the Palay page."
)


def _run(sql: str, **params: object) -> None:
    op.execute(sa.text(sql).bindparams(**params))


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS profit_target_margin_pct NUMERIC(5, 2)")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS staff_profit_pct NUMERIC(5, 2)")
    for plan in PLANS:
        _run(
            "UPDATE subscription_plans "
            "SET features = COALESCE(features, CAST('[]' AS jsonb)) || jsonb_build_array(CAST(:code AS text)) "
            "WHERE code = :plan AND NOT jsonb_exists(COALESCE(features, CAST('[]' AS jsonb)), :code)",
            plan=plan,
            code=CODE,
        )
    _run(
        "UPDATE subscription_plans SET description = :text WHERE code = 'pro' AND description = :old",
        text=PRO_DESCRIPTION,
        old=OLD_PRO_DESCRIPTION,
    )


def downgrade() -> None:
    _run("UPDATE subscription_plans SET features = features - CAST(:code AS text)", code=CODE)
    _run(
        "UPDATE subscription_plans SET description = :old WHERE code = 'pro' AND description = :text",
        text=PRO_DESCRIPTION,
        old=OLD_PRO_DESCRIPTION,
    )
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS staff_profit_pct")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS profit_target_margin_pct")
