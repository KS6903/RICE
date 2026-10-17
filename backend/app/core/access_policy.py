"""Who can open which page, and what a mill's Boss may change about it.

``SECTION_ACCESS`` is the default matrix: for each role, the level (``full``,
``view`` or ``none``) it has on each page of the app. It mirrors
``packages/shared/src/constants/access.ts``: the UI matrix is an ergonomics
layer, this policy is the actual authorization boundary. It stays explicit and
fail-closed so a newly introduced or typoed role never inherits access.

A mill's Boss may change the matrix for the staff roles, page by page. Those
changes are stored on the company (``companies.role_access``) as only the cells
that differ from the default, so a later change to a default still reaches
every cell the Boss left alone. The rules below keep that from becoming a way
to lock the mill out, or to hand someone control of it:

- The Boss and the Admin always have full access; their rows can't be changed.
- Dashboard, Tasks, Settings and Users are fixed for everyone. Users is how
  someone becomes a Boss or an Admin, and the other three are every account's
  own space, so none of them is the Boss's to hand out or take away.
- Anything stored that breaks these rules (a stale value, a hand-edited row)
  is ignored, never obeyed.
"""

from __future__ import annotations

from typing import Any, Mapping

SECTION_ACCESS: dict[str, dict[str, str]] = {
    "owner": {
        "dashboard": "full",
        "paddy": "full",
        "milling": "full",
        "inventory": "full",
        "sales": "full",
        "dispatch": "full",
        "operators": "full",
        "expenses": "full",
        "reports": "full",
        "employees": "full",
        "users": "full",
        "settings": "full",
        "automations": "full",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
    "admin": {
        "dashboard": "full",
        "paddy": "full",
        "milling": "full",
        "inventory": "full",
        "sales": "full",
        "dispatch": "full",
        "operators": "full",
        "expenses": "full",
        "reports": "full",
        "employees": "full",
        "users": "full",
        "settings": "full",
        "automations": "full",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
    "accountant": {
        "dashboard": "full",
        "paddy": "view",
        "milling": "view",
        "inventory": "view",
        "sales": "full",
        "dispatch": "view",
        "operators": "view",
        "expenses": "full",
        "reports": "full",
        "employees": "full",
        "users": "none",
        "settings": "full",
        "automations": "view",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
    "cashier": {
        "dashboard": "full",
        "paddy": "none",
        "milling": "none",
        "inventory": "view",
        "sales": "full",
        "dispatch": "view",
        "operators": "view",
        "expenses": "none",
        "reports": "none",
        "employees": "none",
        "users": "none",
        "settings": "full",
        "automations": "none",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
    "mill_operator": {
        "dashboard": "full",
        "paddy": "full",
        "milling": "full",
        "inventory": "full",
        "sales": "none",
        "dispatch": "full",
        "operators": "full",
        "expenses": "none",
        "reports": "none",
        "employees": "none",
        "users": "none",
        "settings": "full",
        "automations": "none",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
    "encoder": {
        "dashboard": "full",
        "paddy": "full",
        "milling": "view",
        "inventory": "view",
        "sales": "full",
        "dispatch": "none",
        "operators": "none",
        "expenses": "none",
        "reports": "none",
        "employees": "none",
        "users": "none",
        "settings": "full",
        "automations": "none",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
}

APP_SECTIONS = frozenset(next(iter(SECTION_ACCESS.values())))

ALL_SECTIONS: tuple[str, ...] = tuple(next(iter(SECTION_ACCESS.values())))
LEVELS: tuple[str, ...] = ("none", "view", "full")

# The Boss and the Admin run the mill: their access is never narrowed.
FIXED_ROLES: frozenset[str] = frozenset({"owner", "admin"})
# The roles whose access the Boss can change.
STAFF_ROLES: tuple[str, ...] = tuple(r for r in SECTION_ACCESS if r not in FIXED_ROLES)
# Pages that are the same for everyone it applies to (see the module docstring).
LOCKED_SECTIONS: frozenset[str] = frozenset({"dashboard", "tasks", "settings", "users"})
# The pages the Boss can open to a role, or take away from it.
CONFIGURABLE_SECTIONS: tuple[str, ...] = tuple(s for s in ALL_SECTIONS if s not in LOCKED_SECTIONS)


def stored_changes(overrides: Any, role_name: str | None) -> dict[str, str]:
    """The changes stored for a role that still count: a staff role, a page the
    Boss can change, and a level that exists. Anything else is dropped."""
    if role_name not in STAFF_ROLES or not isinstance(overrides, Mapping):
        return {}
    raw = overrides.get(role_name)
    if not isinstance(raw, Mapping):
        return {}
    return {s: lvl for s, lvl in raw.items() if s in CONFIGURABLE_SECTIONS and lvl in LEVELS}


def access_for_role(role_name: str | None, overrides: Any = None) -> dict[str, str]:
    """Every page's level for a role in a mill: the default, with that mill's
    changes. An unknown or missing role has no access to anything."""
    base = SECTION_ACCESS.get(role_name or "")
    if base is None:
        return dict.fromkeys(ALL_SECTIONS, "none")
    levels = dict(base)
    levels.update(stored_changes(overrides, role_name))
    return levels


def section_level(role_name: str | None, section: str, overrides: Any = None) -> str:
    return access_for_role(role_name, overrides).get(section, "none")


def company_overrides(user: Any) -> Any:
    """The changes the signed-in person's mill has made to the matrix, if any."""
    return getattr(getattr(user, "company", None), "role_access", None)


def access_for_user(user: Any) -> dict[str, str]:
    """Every page's level for the signed-in person, as the app should show it."""
    if getattr(user, "is_platform_admin", False):
        return dict.fromkeys(ALL_SECTIONS, "full")
    role_name = getattr(getattr(user, "role", None), "name", None)
    return access_for_role(role_name, company_overrides(user))


def clean_changes(role_name: str, wanted: Mapping[str, str]) -> dict[str, str]:
    """What to store for a role from the levels the Boss chose: only the pages
    that differ from the default. Refuses what can't be changed, by raising
    ValueError with a message fit to show."""
    if role_name in FIXED_ROLES:
        raise ValueError("The Boss and the Admin always have full access.")
    if role_name not in STAFF_ROLES:
        raise ValueError("That role can't be changed.")
    default = SECTION_ACCESS[role_name]
    changes: dict[str, str] = {}
    for section, level in wanted.items():
        if section not in ALL_SECTIONS:
            raise ValueError(f"Unknown page: {section}.")
        if section in LOCKED_SECTIONS:
            raise ValueError(f"The {section} page can't be changed here.")
        if level not in LEVELS:
            raise ValueError(f"Unknown level: {level}.")
        if level != default[section]:
            changes[section] = level
    return changes
