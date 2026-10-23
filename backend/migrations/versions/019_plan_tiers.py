"""Repackage the plans: Basic unlocks milling, dispatch and the drying advisor;
Pro unlocks field operators, cash count and collections.

- Free loses milling. Dispatch and field operators were reachable on any plan
  with sales (Free included); they get their own feature codes now.
- Basic: + milling, + dispatch, + drying_advisor, 5 users instead of 7 (the owner counts as
  one: the limit counts every active user of the mill), and 3 warehouses
  instead of 2.
- Pro: + milling, + dispatch, + drying_advisor, + field_operators,
  + cash_count, + collections (employees it already had).
- Warehouses (each one is a branch: "Add warehouse" creates a branch): Free 1,
  Basic 3, Pro 5, Enterprise unlimited. Only Basic's changes.
- Enterprise: everything, the new codes included. Automations, the To do
  list, stock count and maintenance stay Enterprise only.

Each plan's description says what it adds; the billing page shows it on
the plan's card, with the users and branches next to it.

Plain SQL rather than the ORM model, as in 009 and 016, so a later column on
subscription_plans can't break this migration. Only adds codes a plan lacks,
so running it on a plan an admin already edited does no harm.

Revision ID: 019_plan_tiers
Revises: 018_annual_discount
Create Date: 2026-10-23
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "019_plan_tiers"
down_revision = "018_annual_discount"
branch_labels = None
depends_on = None

NEW_CODES = ("dispatch", "field_operators", "cash_count", "collections")

BASIC_MAX_USERS = 5
# Warehouses per plan (subscription_plans.max_branches); None is unlimited.
MAX_WAREHOUSES: dict[str, int | None] = {"free": 1, "basic": 3, "pro": 5, "enterprise": None}

GRANTS = {
    "basic": ("milling", "dispatch", "drying_advisor"),
    "pro": ("milling", "dispatch", "drying_advisor", "field_operators", "cash_count", "collections"),
    "enterprise": ("milling", "dispatch", "field_operators", "cash_count", "collections"),
}


DESCRIPTIONS = {
    "free": "Get started: buy palay, keep stock, sell, and track expenses.",
    "basic": "Adds milling, dispatch and palay drying advice: mill your own palay and deliver the orders.",
    "pro": "Adds field operators, cash count, collections, employees and advanced reports.",
    "enterprise": "Everything, plus automations, compliance reports and offline sync.",
}
# As the baseline seeded them, for downgrade.
OLD_DESCRIPTIONS = {
    "free": "Get started with core operations. Single branch, small team.",
    "basic": "Step up from Free. Two branches and a slightly bigger team.",
    "pro": "For growing rice mills. Multi-branch, employees, advanced reports.",
    "enterprise": "Full ERP. Compliance reports, offline sync, unlimited users and branches.",
}


def _describe(descriptions: dict[str, str]) -> None:
    for plan, text in descriptions.items():
        _run("UPDATE subscription_plans SET description = :text WHERE code = :plan", text=text, plan=plan)


def _run(sql: str, **params: object) -> None:
    op.execute(sa.text(sql).bindparams(**params))


def _grant(plan: str, code: str) -> None:
    """Add a feature code to a plan, unless it has it already."""
    _run(
        "UPDATE subscription_plans "
        "SET features = COALESCE(features, CAST('[]' AS jsonb)) || jsonb_build_array(CAST(:code AS text)) "
        "WHERE code = :plan AND NOT jsonb_exists(COALESCE(features, CAST('[]' AS jsonb)), :code)",
        plan=plan,
        code=code,
    )


def _revoke(plan: str | None, code: str) -> None:
    """Take a feature code off a plan (every plan when plan is None)."""
    where = " WHERE code = :plan" if plan else ""
    params: dict[str, object] = {"code": code}
    if plan:
        params["plan"] = plan
    _run(f"UPDATE subscription_plans SET features = features - CAST(:code AS text){where}", **params)


def upgrade() -> None:
    for plan, codes in GRANTS.items():
        for code in codes:
            _grant(plan, code)
    _revoke("free", "milling")
    _run("UPDATE subscription_plans SET max_users = :n WHERE code = 'basic'", n=BASIC_MAX_USERS)
    for plan, limit in MAX_WAREHOUSES.items():
        _run("UPDATE subscription_plans SET max_branches = :n WHERE code = :plan", n=limit, plan=plan)
    _describe(DESCRIPTIONS)


def downgrade() -> None:
    for code in NEW_CODES:
        _revoke(None, code)
    _revoke("basic", "drying_advisor")
    _revoke("pro", "drying_advisor")
    _grant("free", "milling")
    _run("UPDATE subscription_plans SET max_users = :n WHERE code = 'basic'", n=7)
    _run("UPDATE subscription_plans SET max_branches = :n WHERE code = 'basic'", n=2)
    _describe(OLD_DESCRIPTIONS)
