"""The Boss's changes to the role matrix: what counts, and what is ignored."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.access_policy import (
    ALL_SECTIONS,
    CONFIGURABLE_SECTIONS,
    FIXED_ROLES,
    LOCKED_SECTIONS,
    SECTION_ACCESS,
    STAFF_ROLES,
    access_for_role,
    access_for_user,
    clean_changes,
    section_level,
)
from app.core.security import require_section_access

NOTHING = {s: "none" for s in ALL_SECTIONS}


def _user(role_name, role_access=None, *, platform_admin=False):
    return SimpleNamespace(
        role=SimpleNamespace(name=role_name),
        is_platform_admin=platform_admin,
        company=SimpleNamespace(role_access=role_access),
    )


def test_the_boss_and_admin_are_fixed_and_the_rest_are_staff():
    assert FIXED_ROLES == {"owner", "admin"}
    assert set(STAFF_ROLES) == {"accountant", "cashier", "mill_operator", "encoder"}
    assert set(CONFIGURABLE_SECTIONS) == set(ALL_SECTIONS) - LOCKED_SECTIONS
    assert LOCKED_SECTIONS == {"dashboard", "tasks", "settings", "users"}


@pytest.mark.parametrize("overrides", [None, {}, {"cashier": {}}])
def test_no_changes_means_the_defaults(overrides):
    for role, levels in SECTION_ACCESS.items():
        assert access_for_role(role, overrides) == levels


def test_a_change_applies_to_that_role_only():
    changes = {"cashier": {"reports": "view", "dispatch": "full"}}
    assert section_level("cashier", "reports", changes) == "view"
    assert section_level("cashier", "dispatch", changes) == "full"
    # Every other cell of the cashier, and the same page for another role, is as it was.
    assert section_level("cashier", "paddy", changes) == SECTION_ACCESS["cashier"]["paddy"]
    assert section_level("encoder", "reports", changes) == SECTION_ACCESS["encoder"]["reports"]


def test_a_page_can_be_taken_away_as_well_as_given():
    assert SECTION_ACCESS["accountant"]["employees"] == "full"
    assert section_level("accountant", "employees", {"accountant": {"employees": "none"}}) == "none"


@pytest.mark.parametrize("role", sorted(FIXED_ROLES))
def test_the_boss_and_admin_can_never_be_narrowed(role):
    assert access_for_role(role, {role: NOTHING}) == SECTION_ACCESS[role]


@pytest.mark.parametrize("section", sorted(LOCKED_SECTIONS))
def test_locked_pages_ignore_stored_changes(section):
    changes = {"cashier": {section: "full"}, "encoder": {section: "none"}}
    assert section_level("cashier", section, changes) == SECTION_ACCESS["cashier"][section]
    assert section_level("encoder", section, changes) == SECTION_ACCESS["encoder"][section]


@pytest.mark.parametrize(
    "junk",
    [
        "full",
        5,
        ["cashier"],
        {"cashier": "full"},
        {"cashier": {"reports": "admin"}},
        {"cashier": {"not_a_page": "full"}},
        {"ghost": {"reports": "full"}},
    ],
)
def test_anything_odd_that_was_stored_is_ignored(junk):
    assert access_for_role("cashier", junk) == SECTION_ACCESS["cashier"]


def test_an_unknown_or_missing_role_gets_nothing_whatever_is_stored():
    stored = {"ghost": {"reports": "full"}}
    assert access_for_role("ghost", stored) == NOTHING
    assert access_for_role(None, stored) == NOTHING


def test_clean_changes_keeps_only_what_differs_from_the_default():
    assert SECTION_ACCESS["cashier"]["paddy"] == "none"
    assert clean_changes("cashier", {"reports": "view", "paddy": "none"}) == {"reports": "view"}
    assert clean_changes("cashier", {}) == {}


@pytest.mark.parametrize(
    ("role", "wanted", "message"),
    [
        ("owner", {}, "always have full access"),
        ("admin", {"reports": "none"}, "always have full access"),
        ("ghost", {}, "can't be changed"),
        ("cashier", {"users": "full"}, "can't be changed here"),
        ("cashier", {"settings": "none"}, "can't be changed here"),
        ("cashier", {"dashboard": "none"}, "can't be changed here"),
        ("cashier", {"not_a_page": "view"}, "Unknown page"),
        ("cashier", {"reports": "admin"}, "Unknown level"),
    ],
)
def test_clean_changes_refuses_what_cannot_be_changed(role, wanted, message):
    with pytest.raises(ValueError, match=message):
        clean_changes(role, wanted)


def test_the_guard_follows_the_mills_changes():
    cashier = _user("cashier", {"cashier": {"reports": "view"}})
    assert require_section_access("reports")(cashier) is cashier
    with pytest.raises(HTTPException) as exc:
        require_section_access("reports", write=True)(cashier)
    assert exc.value.status_code == 403

    # And a page taken away is closed to reads too.
    accountant = _user("accountant", {"accountant": {"employees": "none"}})
    with pytest.raises(HTTPException) as exc:
        require_section_access("employees")(accountant)
    assert exc.value.status_code == 403


def test_the_guard_uses_the_defaults_when_the_mill_changed_nothing():
    for stored in (None, {}):
        with pytest.raises(HTTPException):
            require_section_access("reports")(_user("cashier", stored))
        assert require_section_access("reports")(_user("accountant", stored))


def test_the_guard_still_denies_an_unknown_role_that_somebody_stored_access_for():
    ghost = _user("ghost", {"ghost": {"reports": "full"}})
    with pytest.raises(HTTPException):
        require_section_access("reports")(ghost)


def test_access_for_user_is_what_the_app_is_told():
    assert access_for_user(_user("cashier", {"cashier": {"reports": "view"}}))["reports"] == "view"
    assert access_for_user(_user("owner")) == SECTION_ACCESS["owner"]
    assert access_for_user(_user(None, platform_admin=True)) == {s: "full" for s in ALL_SECTIONS}
