"""The automations demo seeding runs on an Enterprise tenant and leaves
something on every page the automations lead to."""

from __future__ import annotations

from seed_demo_automations import seed

from app.models.action import ActionItem
from app.models.automation import AutomationRule
from app.models.cash import CashCount
from app.models.maintenance import Equipment


def test_the_demo_fills_the_new_pages(db_session, seed_owner):
    out = seed(db_session, "owner", reset=False)
    assert "rule-based automations switched on" in out, out
    rules = {r.recipe: r for r in db_session.query(AutomationRule).all()}
    assert rules["due_reminders"].track and rules["wet_palay"].track
    assert db_session.query(ActionItem).count() == 3
    assert db_session.query(CashCount).count() == 7
    assert {e.name for e in db_session.query(Equipment)} == {"Rubber-roll huller", "Polisher"}
    # Seeding again changes nothing without --reset.
    assert "already seeded" in seed(db_session, "owner", reset=False)
