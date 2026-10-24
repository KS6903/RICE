"""RoleAccessService: what each role can open in a mill, and the Boss changing it.

The default matrix and the rules for changing it are in core/access_policy.py.
This stores the Boss's changes, to the built-in roles on the company and to the
roles the Boss made up in company_roles, and writes them to the activity log, so
there is a record of who opened a page to whom.
"""

from __future__ import annotations

import uuid
from typing import Any, Mapping

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from ..core.access_policy import (
    ALL_SECTIONS,
    EDIT_POWER,
    FIXED_ROLES,
    SECTION_ACCESS,
    STAFF_ROLES,
    access_for_role,
    clean_access,
    clean_changes,
    clean_role_name,
    custom_role_access,
    custom_role_edit_power,
    edit_power_for_role,
)
from ..core.exceptions import BadRequestError, NotFoundError
from ..models.company import Company
from ..models.user import CompanyRole, User
from ..services.activity import log_activity
from ..services.base import BaseService

# A mill makes up a handful of roles, not hundreds.
MAX_CUSTOM_ROLES = 20
# A made-up role can't pass for a built-in one in the users list.
BUILT_IN_NAMES = frozenset({"boss", "owner", "admin", "accountant", "cashier", "mill operator", "encoder"})


class RoleAccessService(BaseService):
    def _company(self) -> Company:
        company_id = getattr(self.current_user, "company_id", None)
        company = self.db.get(Company, company_id) if company_id else None
        if company is None:
            raise NotFoundError("Company not found")
        return company

    def _custom_roles(self, company: Company) -> list[CompanyRole]:
        return list(
            self.db.scalars(select(CompanyRole).where(CompanyRole.company_id == company.id).order_by(CompanyRole.name))
        )

    def _custom_role(self, role_id: uuid.UUID) -> CompanyRole:
        company = self._company()
        role = self.db.get(CompanyRole, role_id)
        if role is None or role.company_id != company.id:
            raise NotFoundError("Role not found")
        return role

    def _people(self, company: Company) -> dict[uuid.UUID, int]:
        """How many people of the mill (not removed) hold each of its made-up roles."""
        rows = self.db.execute(
            select(User.custom_role_id, func.count())
            .where(User.company_id == company.id, User.custom_role_id.is_not(None), User.is_active.is_(True))
            .group_by(User.custom_role_id)
        )
        return {role_id: count for role_id, count in rows if role_id is not None}

    def _view(self, company: Company) -> dict:
        """Every role's level on every page as it stands now: the built-in ones
        beside their default, and the ones the Boss made up."""
        overrides = company.role_access
        people = self._people(company)
        return {
            "sections": list(ALL_SECTIONS),
            "roles": [
                {
                    "role": role,
                    "editable": role not in FIXED_ROLES,
                    "access": access_for_role(role, overrides),
                    "defaults": dict(SECTION_ACCESS[role]),
                    "edit_power": edit_power_for_role(role, overrides),
                }
                for role in SECTION_ACCESS
            ],
            "custom_roles": [
                {
                    "id": str(r.id),
                    "name": r.name,
                    "access": custom_role_access(r.access),
                    "edit_power": custom_role_edit_power(r.access),
                    "people": people.get(r.id, 0),
                }
                for r in self._custom_roles(company)
            ],
        }

    def get(self) -> dict:
        return self._view(self._company())

    def set_role(self, role: str, access: Mapping[str, str]) -> dict:
        """Set what one built-in role can open: ``access`` is its level on each
        page it names, and a page left out goes back to its default."""
        company = self._company()
        try:
            changes = clean_changes(role, access)
        except ValueError as e:
            raise BadRequestError(str(e)) from e

        # A new dict, so the column is seen to have changed.
        stored = {r: dict(c) for r, c in (company.role_access or {}).items() if isinstance(c, dict)}
        # Setting the pages keeps the role's edit power as it was.
        kept: dict[str, Any] = {**changes, EDIT_POWER: True} if edit_power_for_role(role, stored) else dict(changes)
        if kept:
            stored[role] = kept
        else:
            stored.pop(role, None)

        with self.transaction():
            company.role_access = stored or None
            self._log(
                company,
                "role_access.update",
                role,
                (
                    ", ".join(f"{section}: {level}" for section, level in changes.items())
                    if changes
                    else "back to the defaults"
                ),
            )
        return self._view(company)

    def set_edit_power(self, role: str, on: bool) -> dict:
        """Give a built-in role edit power, or take it away. The Boss always has it."""
        if role in FIXED_ROLES:
            raise BadRequestError("The Boss always has edit power.")
        if role not in STAFF_ROLES:
            raise BadRequestError("That role can't be changed.")
        company = self._company()
        stored = {r: dict(c) for r, c in (company.role_access or {}).items() if isinstance(c, dict)}
        entry = {k: v for k, v in stored.get(role, {}).items() if k != EDIT_POWER}
        if on:
            entry[EDIT_POWER] = True
        if entry:
            stored[role] = entry
        else:
            stored.pop(role, None)
        with self.transaction():
            company.role_access = stored or None
            self._log(company, "role_access.edit_power", role, "on" if on else "off")
        return self._view(company)

    def set_custom_edit_power(self, role_id: uuid.UUID, on: bool) -> dict:
        """Give a made-up role edit power, or take it away."""
        role = self._custom_role(role_id)
        company = self._company()
        access: dict[str, Any] = dict(custom_role_access(role.access))
        if on:
            access[EDIT_POWER] = True
        with self.transaction():
            # A new dict, so the column is seen to have changed.
            role.access = access
            self._log(company, "role_access.edit_power", role.name, "on" if on else "off")
        return self._view(company)

    # ── roles the Boss makes up ──────────────────────────────────────────────

    def _clean(self, company: Company, name: str, access: Mapping[str, str], *, keep: CompanyRole | None = None):
        try:
            cleaned_name = clean_role_name(name)
            cleaned_access = clean_access(access)
        except ValueError as e:
            raise BadRequestError(str(e)) from e
        if cleaned_name.casefold() in BUILT_IN_NAMES:
            raise BadRequestError(f'"{cleaned_name}" is already a role. Choose another name.')
        for other in self._custom_roles(company):
            if other is not keep and other.name.casefold() == cleaned_name.casefold():
                raise BadRequestError(f'There is already a role called "{other.name}".')
        return cleaned_name, cleaned_access

    def create_custom(self, name: str, access: Mapping[str, str]) -> dict:
        company = self._company()
        if len(self._custom_roles(company)) >= MAX_CUSTOM_ROLES:
            raise BadRequestError(f"A mill can have up to {MAX_CUSTOM_ROLES} roles of its own.")
        cleaned_name, cleaned_access = self._clean(company, name, access)
        try:
            with self.transaction():
                role = CompanyRole(company_id=company.id, name=cleaned_name, access=cleaned_access)
                self.db.add(role)
                self.db.flush()
                self._log(company, "role_access.create", cleaned_name, _describe(cleaned_access))
        except IntegrityError as e:
            raise BadRequestError(f'There is already a role called "{cleaned_name}".') from e
        return self._view(company)

    def update_custom(self, role_id: uuid.UUID, name: str | None, access: Mapping[str, str] | None) -> dict:
        role = self._custom_role(role_id)
        company = self._company()
        cleaned_name, cleaned_access = self._clean(
            company,
            role.name if name is None else name,
            custom_role_access(role.access) if access is None else access,
            keep=role,
        )
        old_name = role.name
        try:
            with self.transaction():
                role.name = cleaned_name
                # A new dict, so the column is seen to have changed. Setting
                # the pages keeps the role's edit power as it was.
                kept: dict[str, Any] = dict(cleaned_access)
                if custom_role_edit_power(role.access):
                    kept[EDIT_POWER] = True
                role.access = kept
                detail = _describe(cleaned_access)
                if cleaned_name != old_name:
                    detail = f"renamed from {old_name}; {detail}"
                self._log(company, "role_access.custom_update", cleaned_name, detail)
        except IntegrityError as e:
            raise BadRequestError(f'There is already a role called "{cleaned_name}".') from e
        return self._view(company)

    def delete_custom(self, role_id: uuid.UUID) -> dict:
        role = self._custom_role(role_id)
        company = self._company()
        holders = (
            self.db.scalar(
                select(func.count()).select_from(User).where(User.custom_role_id == role.id, User.is_active.is_(True))
            )
            or 0
        )
        if holders:
            who = "1 person has" if holders == 1 else f"{holders} people have"
            raise BadRequestError(f"{who} this role. Give them another role first, on the Users page.")
        with self.transaction():
            # Someone removed from the mill doesn't hold the role up: they lose
            # it, and, restored, open nothing until they're given another.
            self.db.execute(update(User).where(User.custom_role_id == role.id).values(custom_role_id=None))
            self._log(company, "role_access.delete", role.name, None)
            self.db.delete(role)
        return self._view(company)

    def _log(self, company: Company, action: str, label: str, detail: Any) -> None:
        log_activity(
            self.db,
            company_id=company.id,
            user_id=self.current_user.id,
            action=action,
            entity_type="role_access",
            entity_label=label,
            detail=detail,
        )


def _describe(access: Mapping[str, str]) -> str:
    opened = [f"{s}: {lvl}" for s, lvl in access.items() if lvl != "none"]
    return ", ".join(opened) if opened else "opens nothing"
