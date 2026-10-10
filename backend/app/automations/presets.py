"""Starter sets: the automations a mill of each size should switch on first.

A small owner-run mill needs the day's money, stock and palay with no setting
up; a growing mill with staff needs follow-through on collections and the
floor; a large mill needs the full watch, with alerts tracked as tasks. A set
only switches things on: automations already set up keep their settings and
recipients, and nothing is switched off.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models.automation import AutomationRule
from .engine import eligible_users
from .recipes import RECIPES


@dataclass(frozen=True)
class Preset:
    code: str
    title: str
    description: str
    recipes: tuple[str, ...]
    # Recipes whose alerts become tasks: (recipe, role to give them to, due within hours).
    tracked: tuple[tuple[str, str, int], ...] = ()


SMALL = (
    "owner_digest",
    "due_reminders",
    "cash_up",
    "cash_count",
    "low_stock",
    "wet_palay",
)
GROWING = (
    *SMALL,
    "call_list",
    "credit_guard",
    "big_transaction",
    "milling_quality",
    "left_open",
    "late_deliveries",
    "no_truck",
    "weekly_summary",
)
LARGE = (
    *GROWING,
    "sale_pricing",
    "late_edit",
    "cancellations",
    "unusual_expense",
    "palay_price_outlier",
    "negative_stock",
    "shelf_life",
    "zone_overweight",
    "quiet_customers",
    "month_end",
    "month_in_review",
)

PRESETS: dict[str, Preset] = {
    p.code: p
    for p in (
        Preset(
            "small",
            "Small mill, run by the owner",
            "The essentials, with nothing to set up: yesterday's figures each morning, who owes you, "
            "the day's cash and the drawer count, rice running low, and wet palay waiting to dry.",
            SMALL,
        ),
        Preset(
            "growing",
            "Growing mill with staff",
            "The essentials, plus the weekly call list, the credit limit guard, big transactions, "
            "milling and delivery checks. Collections and wet palay become tasks with someone on them.",
            GROWING,
            tracked=(("due_reminders", "accountant", 24), ("wet_palay", "mill_operator", 6)),
        ),
        Preset(
            "large",
            "Large or multi-branch mill",
            "Everything above, plus the full owner watch, stock checks, and the month-end close. "
            "More alerts become tasks, so nothing sits unread.",
            LARGE,
            tracked=(
                ("due_reminders", "accountant", 24),
                ("wet_palay", "mill_operator", 6),
                ("negative_stock", "mill_operator", 24),
                ("late_deliveries", "mill_operator", 6),
                ("left_open", "mill_operator", 12),
            ),
        ),
    )
}


def apply(db: Session, company_id: uuid.UUID, preset: Preset, user_id: uuid.UUID) -> list[str]:
    """Switch the set's automations on and track the ones it tracks. Returns
    the codes newly switched on. Doesn't commit."""
    rules = {r.recipe: r for r in db.query(AutomationRule).all()}
    switched: list[str] = []
    for code in preset.recipes:
        recipe = RECIPES[code]
        rule = rules.get(code)
        if rule is None:
            rule = AutomationRule(
                company_id=company_id, recipe=code, params=recipe.params().model_dump(), recipients=[]
            )
            db.add(rule)
            rules[code] = rule
        if not rule.enabled:
            rule.enabled = True
            rule.updated_by = user_id
            switched.append(code)
    for code, role, hours in preset.tracked:
        rule = rules[code]
        if rule.track:
            continue  # already tracked as the mill set it up
        person = next(
            (u for u in eligible_users(db, company_id, RECIPES[code]) if u.role and u.role.name == role), None
        )
        rule.track, rule.track_assignee, rule.track_due_hours = True, person.id if person else None, hours
    return switched
