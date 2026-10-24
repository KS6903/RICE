"""The Boss's changes to the role matrix: what counts, and what is ignored."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.access_policy import (
    ALL_SECTIONS,
    CONFIGURABLE_SECTIONS,
    FIXED_ROLES,
    SECTION_ACCESS,
    STAFF_ROLES,
    access_for_role,
    access_for_user,
    clean_access,
    clean_changes,
    clean_role_name,
    custom_role_access,
    section_level,
    within,
)
from app.core.security import require_section_access

NOTHING = {s: "none" for s in ALL_SECTIONS}


COMPANY = "mill-1"


def _user(role_name, role_access=None, *, platform_admin=False, custom=None):
    return SimpleNamespace(
        role=SimpleNamespace(name=role_name) if role_name else None,
        custom_role=custom,
        company_id=COMPANY,
        is_platform_admin=platform_admin,
        company=SimpleNamespace(role_access=role_access),
    )


def _custom(access, company_id=COMPANY):
    return SimpleNamespace(access=access, company_id=company_id)


def test_only_the_boss_is_fixed_and_every_page_can_be_changed():
    assert FIXED_ROLES == {"owner"}
    assert set(STAFF_ROLES) == {"admin", "accountant", "cashier", "mill_operator", "encoder"}
    assert set(CONFIGURABLE_SECTIONS) == set(ALL_SECTIONS)


def test_settings_is_the_mills_settings_so_staff_start_without_it():
    assert SECTION_ACCESS["owner"]["settings"] == "full"
    assert SECTION_ACCESS["admin"]["settings"] == "full"
    for role in ("accountant", "cashier", "mill_operator", "encoder"):
        assert SECTION_ACCESS[role]["settings"] == "none"


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


def test_the_boss_can_never_be_narrowed():
    assert access_for_role("owner", {"owner": NOTHING}) == SECTION_ACCESS["owner"]


def test_the_admin_can_be_narrowed_like_anyone_else():
    assert section_level("admin", "users", {"admin": {"users": "none"}}) == "none"
    assert section_level("admin", "reports", {"admin": {"reports": "view"}}) == "view"


@pytest.mark.parametrize("section", ["dashboard", "tasks", "settings", "users"])
def test_the_pages_that_used_to_be_fixed_follow_stored_changes(section):
    changes = {"cashier": {section: "full"}, "encoder": {section: "none"}}
    assert section_level("cashier", section, changes) == "full"
    assert section_level("encoder", section, changes) == "none"


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
        ("owner", {}, "always has full access"),
        ("owner", {"reports": "none"}, "always has full access"),
        ("ghost", {}, "can't be changed"),
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


def test_clean_changes_lets_the_admin_and_every_page_change():
    assert clean_changes("admin", {"users": "none", "reports": "view"}) == {"users": "none", "reports": "view"}
    assert clean_changes("cashier", {"settings": "view", "dashboard": "none"}) == {
        "settings": "view",
        "dashboard": "none",
    }


def test_access_for_user_is_what_the_app_is_told():
    assert access_for_user(_user("cashier", {"cashier": {"reports": "view"}}))["reports"] == "view"
    assert access_for_user(_user("owner")) == SECTION_ACCESS["owner"]
    assert access_for_user(_user(None, platform_admin=True)) == {s: "full" for s in ALL_SECTIONS}


# ── roles the Boss makes up ──────────────────────────────────────────────────


def test_a_made_up_role_opens_only_what_it_names():
    access = custom_role_access({"inventory": "full", "reports": "view"})
    assert access["inventory"] == "full"
    assert access["reports"] == "view"
    assert access["sales"] == "none"
    assert set(access) == set(ALL_SECTIONS)


@pytest.mark.parametrize("junk", [None, "full", ["inventory"], {"inventory": "admin"}, {"ghost": "full"}])
def test_anything_odd_stored_for_a_made_up_role_is_closed(junk):
    assert custom_role_access(junk) == NOTHING


def test_someone_with_a_made_up_role_gets_its_access():
    person = _user(None, custom=_custom({"inventory": "full"}))
    assert access_for_user(person)["inventory"] == "full"
    assert access_for_user(person)["sales"] == "none"
    assert require_section_access("inventory", write=True)(person) is person
    with pytest.raises(HTTPException):
        require_section_access("sales")(person)


def test_a_made_up_role_of_another_mill_opens_nothing():
    person = _user(None, custom=_custom({"inventory": "full"}, company_id="mill-2"))
    assert access_for_user(person) == NOTHING


def test_clean_access_closes_what_is_left_out_and_refuses_junk():
    assert clean_access({"inventory": "view"}) == {**NOTHING, "inventory": "view"}
    with pytest.raises(ValueError, match="Unknown page"):
        clean_access({"not_a_page": "view"})
    with pytest.raises(ValueError, match="Unknown level"):
        clean_access({"inventory": "admin"})


def test_a_role_name_is_tidied_and_must_be_there():
    assert clean_role_name("  Warehouse   Manager ") == "Warehouse Manager"
    with pytest.raises(ValueError, match="name"):
        clean_role_name("   ")
    with pytest.raises(ValueError, match="at most"):
        clean_role_name("x" * 51)


def test_within_compares_page_by_page():
    cashier = SECTION_ACCESS["cashier"]
    assert within(cashier, SECTION_ACCESS["owner"])
    assert within(NOTHING, cashier)
    assert not within(SECTION_ACCESS["admin"], cashier)
    assert not within({**NOTHING, "reports": "full"}, {**NOTHING, "reports": "view"})
