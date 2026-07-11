"""Fail-closed tests for the server-side role/section policy."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.security import APP_SECTIONS, SECTION_ACCESS, require_roles, require_section_access


def _user(role_name: str | None, *, platform_admin: bool = False):
    role = SimpleNamespace(name=role_name) if role_name is not None else None
    return SimpleNamespace(role=role, is_platform_admin=platform_admin)


@pytest.mark.parametrize(
    ("role_name", "section", "write", "expected"),
    [
        (role_name, section, write, expected)
        for role_name, access in SECTION_ACCESS.items()
        for section, level in access.items()
        for write, expected in (
            (False, level in {"view", "full"}),
            (True, level == "full"),
        )
    ],
)
def test_section_policy_matches_matrix(role_name, section, write, expected):
    checker = require_section_access(section, write=write)

    if expected:
        assert checker(_user(role_name)).role.name == role_name
    else:
        with pytest.raises(HTTPException) as exc:
            checker(_user(role_name))
        assert exc.value.status_code == 403


@pytest.mark.parametrize("role_name", [None, "", "unknown", "Owner", "platform_admin"])
@pytest.mark.parametrize("section", sorted(APP_SECTIONS))
@pytest.mark.parametrize("write", [False, True])
def test_missing_and_unknown_roles_are_denied(role_name, section, write):
    with pytest.raises(HTTPException) as exc:
        require_section_access(section, write=write)(_user(role_name))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("section", sorted(APP_SECTIONS))
@pytest.mark.parametrize("write", [False, True])
def test_platform_admin_bypasses_tenant_section_matrix(section, write):
    user = _user(None, platform_admin=True)
    assert require_section_access(section, write=write)(user) is user


@pytest.mark.parametrize("role_name", [None, "unknown", "cashier"])
def test_require_roles_is_fail_closed(role_name):
    with pytest.raises(HTTPException) as exc:
        require_roles("owner", "admin")(_user(role_name))
    assert exc.value.status_code == 403


def test_require_roles_allows_explicit_role_and_platform_admin():
    owner = _user("owner")
    platform_admin = _user(None, platform_admin=True)
    assert require_roles("owner", "admin")(owner) is owner
    assert require_roles("owner", "admin")(platform_admin) is platform_admin


def test_unknown_section_is_a_programming_error():
    with pytest.raises(ValueError, match="Unknown application section"):
        require_section_access("typo")
