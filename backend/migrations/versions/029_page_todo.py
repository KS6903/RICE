"""The Palay page's own To do window, for Pro plans and up.

A `page_todo` feature code: Pro and Enterprise get it, Free and Basic don't. It
shows a To do button on the Palay page that lists the wet palay still waiting for
its drying to be recorded. It is a window of that page only: the overall To do
page stays Enterprise only (the `automations` feature).

Plain SQL, as in 019. Only adds the code to a plan that lacks it, so running it on
a plan an admin already edited does no harm.

Revision ID: 029_page_todo
Revises: 028_palay_stock_view
Create Date: 2026-10-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "029_page_todo"
down_revision = "028_palay_stock_view"
branch_labels = None
depends_on = None

CODE = "page_todo"
PLANS = ("pro", "enterprise")

PRO_DESCRIPTION = (
    "Adds field operators, cash count, collections, employees, advanced reports and a To do list on the Palay page."
)
# As 019 wrote it, for downgrade.
OLD_PRO_DESCRIPTION = "Adds field operators, cash count, collections, employees and advanced reports."


def _run(sql: str, **params: object) -> None:
    op.execute(sa.text(sql).bindparams(**params))


def upgrade() -> None:
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
