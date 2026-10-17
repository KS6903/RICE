"""RoleAccessService: what each role can open in a mill, and the Boss changing it.

The default matrix and the rules for changing it are in core/access_policy.py.
This stores the Boss's changes on the company and writes them to the activity
log, so there is a record of who opened a page to whom.
"""

from __future__ import annotations

from typing import Any, Mapping

from ..core.access_policy import (
    ALL_SECTIONS,
    CONFIGURABLE_SECTIONS,
    LOCKED_SECTIONS,
    SECTION_ACCESS,
    STAFF_ROLES,
    access_for_role,
    clean_changes,
)
from ..core.exceptions import BadRequestError, NotFoundError
from ..models.company import Company
from ..services.activity import log_activity
from ..services.base import BaseService


class RoleAccessService(BaseService):
    def _company(self) -> Company:
        company_id = getattr(self.current_user, "company_id", None)
        company = self.db.get(Company, company_id) if company_id else None
        if company is None:
            raise NotFoundError("Company not found")
        return company

    @staticmethod
    def _view(overrides: Any) -> dict:
        """Every role's level on every page as it stands now, beside the default."""
        return {
            # The pages the Boss can open to a role or take away from it.
            "sections": list(CONFIGURABLE_SECTIONS),
            "locked_sections": [s for s in ALL_SECTIONS if s in LOCKED_SECTIONS],
            "roles": [
                {
                    "role": role,
                    "editable": role in STAFF_ROLES,
                    "access": access_for_role(role, overrides),
                    "defaults": dict(SECTION_ACCESS[role]),
                }
                for role in SECTION_ACCESS
            ],
        }

    def get(self) -> dict:
        return self._view(self._company().role_access)

    def set_role(self, role: str, access: Mapping[str, str]) -> dict:
        """Set what one staff role can open: ``access`` is its level on each page
        it names, and a page left out goes back to its default."""
        company = self._company()
        try:
            changes = clean_changes(role, access)
        except ValueError as e:
            raise BadRequestError(str(e)) from e

        # A new dict, so the column is seen to have changed.
        stored = {r: dict(c) for r, c in (company.role_access or {}).items() if isinstance(c, dict)}
        if changes:
            stored[role] = changes
        else:
            stored.pop(role, None)

        with self.transaction():
            company.role_access = stored or None
            log_activity(
                self.db,
                company_id=company.id,
                user_id=self.current_user.id,
                action="role_access.update",
                entity_type="role_access",
                entity_label=role,
                detail=(
                    ", ".join(f"{section}: {level}" for section, level in changes.items())
                    if changes
                    else "back to the defaults"
                ),
            )
        return self._view(company.role_access)
