"""Who can open which page, and what a mill's Boss may change about it.

``SECTION_ACCESS`` is the default matrix: for each built-in role, the level
(``full``, ``view`` or ``none``) it has on each page of the app. It mirrors
``packages/shared/src/constants/access.ts``: the UI matrix is an ergonomics
layer, this policy is the actual authorization boundary. It stays explicit and
fail-closed so a newly introduced or typoed role never inherits access.

A mill's Boss may change any role but their own, page by page, every page
included:

- Built-in roles (the Admin and the staff) start from the default. The Boss's
  changes are stored on the company (``companies.role_access``) as only the
  cells that differ from it, so a later change to a default still reaches every
  cell the Boss left alone.
- Roles the Boss makes up (``company_roles``) have no default: each stores its
  level on every page, and a page it doesn't name is closed.
- The Boss always has full access; that row can't be changed. Only the Boss
  changes the matrix (api/role_access.py), and whoever runs the Users page can't
  give anyone more than they have themselves (services/user_service.py), so
  opening Users to someone doesn't hand them the mill.
- "Settings" is the mill's settings: billing, the company, branches, the
  activity log. Everyone keeps their own account (profile, password, two-factor,
  devices) whatever it says, and the branch list other pages need.
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
        "settings": "none",
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
        "settings": "none",
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
        "settings": "none",
        "automations": "none",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
    "encoder": {
        "dashboard": "full",
        "paddy": "full",
        # Encodes batches too, custom milling for walk-in clients included.
        "milling": "full",
        "inventory": "view",
        "sales": "full",
        # Enters who takes each order: the plate number and the driver.
        "dispatch": "full",
        "operators": "none",
        "expenses": "none",
        "reports": "none",
        "employees": "none",
        "users": "none",
        "settings": "none",
        "automations": "none",
        # Their own tasks for everyone; owners and admins see all (api/actions).
        "tasks": "full",
    },
}

APP_SECTIONS = frozenset(next(iter(SECTION_ACCESS.values())))

ALL_SECTIONS: tuple[str, ...] = tuple(next(iter(SECTION_ACCESS.values())))
LEVELS: tuple[str, ...] = ("none", "view", "full")

_RANK = {"none": 0, "view": 1, "full": 2}

# The Boss runs the mill: their access is never narrowed.
FIXED_ROLES: frozenset[str] = frozenset({"owner"})
# The built-in roles whose access the Boss can change: the Admin and the staff.
STAFF_ROLES: tuple[str, ...] = tuple(r for r in SECTION_ACCESS if r not in FIXED_ROLES)
# Every page can be opened to a role or taken away from it.
CONFIGURABLE_SECTIONS: tuple[str, ...] = ALL_SECTIONS
# How long a made-up role's name can be (company_roles.name).
CUSTOM_ROLE_NAME_MAX = 50

# Edit power: the Boss lets a role correct records already saved (an order, an
# invoice, a purchase), every change logged field by field. Not a page: one yes
# or no per role, stored with that role's page levels under this key (which no
# page uses, so the page levels ignore it). The Boss always has it.
EDIT_POWER = "edit_power"


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


def custom_role_access(stored: Any) -> dict[str, str]:
    """A made-up role's level on every page, from what was stored for it: a
    page it doesn't name, or names with a level that doesn't exist, is closed."""
    if not isinstance(stored, Mapping):
        return dict.fromkeys(ALL_SECTIONS, "none")
    return {s: stored[s] if stored.get(s) in LEVELS else "none" for s in ALL_SECTIONS}


def access_for_user(user: Any) -> dict[str, str]:
    """Every page's level for the signed-in person: what the app shows, and what
    the server enforces (core/security.py)."""
    if getattr(user, "is_platform_admin", False):
        return dict.fromkeys(ALL_SECTIONS, "full")
    custom = getattr(user, "custom_role", None)
    if custom is not None:
        # Only a role of the person's own mill counts.
        if getattr(custom, "company_id", None) != getattr(user, "company_id", None):
            return dict.fromkeys(ALL_SECTIONS, "none")
        return custom_role_access(getattr(custom, "access", None))
    role_name = getattr(getattr(user, "role", None), "name", None)
    return access_for_role(role_name, company_overrides(user))


def edit_power_for_role(role_name: str | None, overrides: Any = None) -> bool:
    """Whether a built-in role can correct saved records in a mill."""
    if role_name in FIXED_ROLES:
        return True
    if role_name not in STAFF_ROLES or not isinstance(overrides, Mapping):
        return False
    stored = overrides.get(role_name)
    return isinstance(stored, Mapping) and stored.get(EDIT_POWER) is True


def custom_role_edit_power(stored: Any) -> bool:
    """Whether a made-up role can correct saved records."""
    return isinstance(stored, Mapping) and stored.get(EDIT_POWER) is True


def edit_power_for_user(user: Any) -> bool:
    """Whether the signed-in person can correct saved records. Platform admins
    run the console, not a mill's records."""
    if getattr(user, "is_platform_admin", False):
        return False
    custom = getattr(user, "custom_role", None)
    if custom is not None:
        if getattr(custom, "company_id", None) != getattr(user, "company_id", None):
            return False
        return custom_role_edit_power(getattr(custom, "access", None))
    role_name = getattr(getattr(user, "role", None), "name", None)
    return edit_power_for_role(role_name, company_overrides(user))


def user_section_level(user: Any, section: str) -> str:
    return access_for_user(user).get(section, "none")


def within(access: Mapping[str, str], limit: Mapping[str, str]) -> bool:
    """True when ``access`` opens nothing beyond ``limit``, page by page."""
    return all(_RANK.get(access.get(s, "none"), 0) <= _RANK.get(limit.get(s, "none"), 0) for s in ALL_SECTIONS)


def clean_changes(role_name: str, wanted: Mapping[str, str]) -> dict[str, str]:
    """What to store for a role from the levels the Boss chose: only the pages
    that differ from the default. Refuses what can't be changed, by raising
    ValueError with a message fit to show."""
    if role_name in FIXED_ROLES:
        raise ValueError("The Boss always has full access.")
    if role_name not in STAFF_ROLES:
        raise ValueError("That role can't be changed.")
    default = SECTION_ACCESS[role_name]
    changes: dict[str, str] = {}
    for section, level in wanted.items():
        if section not in ALL_SECTIONS:
            raise ValueError(f"Unknown page: {section}.")
        if level not in LEVELS:
            raise ValueError(f"Unknown level: {level}.")
        if level != default[section]:
            changes[section] = level
    return changes


def clean_access(wanted: Mapping[str, str]) -> dict[str, str]:
    """A made-up role's level on every page, from the levels the Boss chose: a
    page left out is closed. Refuses an unknown page or level with ValueError."""
    for section, level in wanted.items():
        if section not in ALL_SECTIONS:
            raise ValueError(f"Unknown page: {section}.")
        if level not in LEVELS:
            raise ValueError(f"Unknown level: {level}.")
    return {s: wanted.get(s, "none") for s in ALL_SECTIONS}


def clean_role_name(name: str) -> str:
    """A made-up role's name, tidied, or ValueError when it can't be one."""
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise ValueError("Give the role a name.")
    if len(cleaned) > CUSTOM_ROLE_NAME_MAX:
        raise ValueError(f"A role's name can be at most {CUSTOM_ROLE_NAME_MAX} characters.")
    return cleaned
