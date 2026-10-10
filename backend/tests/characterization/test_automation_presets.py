"""Starter sets switch on what a mill of each size needs first, track what
needs someone on it, and never undo what the mill already set up."""

from __future__ import annotations

from app.automations.presets import PRESETS
from app.automations.recipes import RECIPES
from app.models.automation import AutomationRule
from app.models.user import Role, User


def test_every_set_names_real_rule_based_automations():
    for preset in PRESETS.values():
        for code in preset.recipes:
            assert code in RECIPES, code
            assert not RECIPES[code].uses_ai, f"{code}: AI needs the owner's own consent"
        assert {code for code, _, _ in preset.tracked} <= set(preset.recipes)
    small, growing, large = (set(PRESETS[c].recipes) for c in ("small", "growing", "large"))
    assert small < growing < large


def test_a_set_switches_on_and_keeps_what_was_set_up(auth_client, db_session, seed_owner):
    sets = auth_client.get("/api/automations/presets").json()["presets"]
    assert [p["code"] for p in sets] == ["small", "growing", "large"]

    # Set up by hand before: an earlier send time, without email.
    db_session.add(
        AutomationRule(
            company_id=seed_owner.company_id,
            recipe="owner_digest",
            enabled=True,
            params={"send_at": "05:00", "email": False},
            recipients=[],
        )
    )
    db_session.commit()
    res = auth_client.post("/api/automations/presets/small")
    assert res.status_code == 200, res.text
    assert res.json()["switched_on"] == ["due_reminders", "cash_up", "cash_count", "low_stock", "wet_palay"]
    db_session.expire_all()
    digest = db_session.query(AutomationRule).filter(AutomationRule.recipe == "owner_digest").one()
    assert digest.params == {"send_at": "05:00", "email": False}
    # Applying it again changes nothing.
    assert auth_client.post("/api/automations/presets/small").json()["switched_on"] == []


def test_a_bigger_set_tracks_alerts_for_the_right_person(auth_client, db_session, seed_owner):
    role = Role(id=7, name="accountant")
    db_session.add(role)
    db_session.flush()
    books = User(
        company_id=seed_owner.company_id,
        branch_id=seed_owner.branch_id,
        username="books",
        email="books@test.local",
        password_hash=seed_owner.password_hash,
        full_name="Ana Books",
        role_id=role.id,
        is_active=True,
    )
    db_session.add(books)
    db_session.commit()
    assert auth_client.post("/api/automations/presets/growing").status_code == 200
    db_session.expire_all()
    rules = {r.recipe: r for r in db_session.query(AutomationRule).all()}
    assert (rules["due_reminders"].track, rules["due_reminders"].track_assignee) == (True, books.id)
    # No mill operator on this team: the task waits for an owner or admin to assign it.
    assert (rules["wet_palay"].track, rules["wet_palay"].track_assignee, rules["wet_palay"].track_due_hours) == (
        True,
        None,
        6,
    )


def test_only_managers_apply_a_set(make_auth_client):
    client = make_auth_client(features=["automations"], username="books", role_name="accountant")
    assert client.post("/api/automations/presets/small").status_code == 403
    assert client.post("/api/automations/presets/nope").status_code in (403, 404)
