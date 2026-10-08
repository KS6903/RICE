"""UserService — business logic for the users domain (Phase 3).

Includes the plan user-limit gate (402) enforced on creation.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, FeatureRequiredError, NotFoundError, PermissionDeniedError
from ..core.passwords import validate_password_strength
from ..core.security import hash_password
from ..models.company import Branch
from ..models.subscription import Subscription
from ..models.user import Role, User
from ..repositories.users import UserRepository
from ..schemas.users import UserResponse
from ..services.activity import log_activity
from ..services.base import BaseService


class UserService(BaseService):
    def __init__(self, db: Session, current_user: Any, *, users: UserRepository) -> None:
        super().__init__(db, current_user)
        self.users = users

    @staticmethod
    def _safe(user: User) -> UserResponse:
        return UserResponse.model_validate(user)

    def list_users(self) -> list[UserResponse]:
        return [self._safe(user) for user in self.users.list_for_company(self.current_user.company_id)]

    def create_user(self, data) -> UserResponse:
        if self.users.get_by_username(data.username):
            raise BadRequestError("Username already exists")
        # Admin-created users get the same password policy as self-service signup
        # (previously this path had NO password validation at all).
        validate_password_strength(data.password)
        # IDOR / integrity guards: the branch must belong to this company; the
        # role must exist (roles are a small global table).
        self.assert_company_fk(Branch, data.branch_id, label="Branch")
        role = self.db.get(Role, data.role_id) if data.role_id is not None else None
        if data.role_id is not None and role is None:
            raise BadRequestError("Invalid role")
        # Same rule as editing: an admin can't make a Boss, or they could sign in as one.
        if role is not None and role.name == "owner" and not self._editor_is_owner():
            raise PermissionDeniedError("Only the Boss can make someone a Boss.")

        self._assert_seat_free()

        user = User(
            company_id=self.current_user.company_id,
            branch_id=data.branch_id,
            username=data.username,
            email=data.email,
            password_hash=hash_password(data.password),
            full_name=data.full_name,
            role_id=data.role_id,
        )
        with self.transaction():
            self.users.add(user)
            self.db.flush()
            self._log(user, "user.create", f"Role: {role.name}" if role else None)
        self.db.refresh(user)
        return self._safe(user)

    def _editor_is_owner(self) -> bool:
        return bool(self.current_user.role and self.current_user.role.name == "owner")

    def _log(self, user: User, action: str, detail: str | None = None) -> None:
        """Audit row for a change to a member of staff's account, in the company's
        activity log (seen in Settings, and by the platform admin)."""
        log_activity(
            self.db,
            company_id=self.current_user.company_id,
            user_id=self.current_user.id,
            action=action,
            entity_type="user",
            entity_id=user.id,
            entity_label=user.username,
            detail=detail,
        )

    def issue_temporary_password(self, user_id: uuid.UUID) -> dict:
        """The Boss gives a locked-out member of their own staff a temporary password.

        Boss only, as a Boss outranks an admin: an admin able to reset the Boss's
        password could then sign in as the Boss. The Boss's own way back in is the
        platform admin (see AdminService)."""
        if not (self.current_user.role and self.current_user.role.name == "owner"):
            raise PermissionDeniedError("Only the Boss can give someone a temporary password.")
        user = self.users.get_for_company(user_id, self.current_user.company_id)
        if not user:
            raise NotFoundError("User not found")
        if user.id == self.current_user.id:
            raise BadRequestError("To change your own password, use Settings.")
        if user.is_platform_admin:
            raise NotFoundError("User not found")
        if not user.is_active:
            raise BadRequestError("This user was removed. Restore them first.")
        from .auth_service import AuthService

        return AuthService(self.db, self.current_user).issue_temporary_password(user, self.current_user)

    def _assert_seat_free(self) -> None:
        """402 when the plan's user limit is reached. Removed (inactive) users
        don't take a seat."""
        active = self.users.count_active_for_company(self.current_user.company_id)
        sub = self.db.query(Subscription).filter(Subscription.company_id == self.current_user.company_id).first()
        if sub and sub.plan and sub.plan.max_users is not None and active >= sub.plan.max_users:
            raise FeatureRequiredError(
                f"Your plan allows up to {sub.plan.max_users} users. Please upgrade to add more.",
                code="user_limit",
            )

    def update_user(self, user_id: uuid.UUID, data) -> UserResponse:
        """Edit or remove (is_active=False) another user, or restore one.

        Removing is a deactivation, not a delete: the user's past records and
        consent history keep pointing at them, and they can't sign in.
        """
        user = self.users.get_for_company(user_id, self.current_user.company_id)
        if not user:
            raise NotFoundError("User not found")
        new_role = None
        if data.role_id is not None:
            new_role = self.db.get(Role, data.role_id)
            if new_role is None:
                raise BadRequestError("Invalid role")

        # Your own account can't be removed, and you can't change your own role
        # (an owner demoting themselves could leave the mill without one).
        if user.id == self.current_user.id:
            if data.is_active is False:
                raise BadRequestError("You can't remove your own account.")
            if data.role_id is not None and data.role_id != user.role_id:
                raise BadRequestError("You can't change your own role.")

        # Owners (shown as "Boss") outrank admins: only an owner can edit or
        # remove an owner, or make someone an owner.
        if not self._editor_is_owner():
            if user.role and user.role.name == "owner":
                raise PermissionDeniedError("Only the Boss can change a Boss account.")
            if new_role is not None and new_role.name == "owner":
                raise PermissionDeniedError("Only the Boss can make someone a Boss.")

        # Restoring a removed user takes a seat again.
        if data.is_active is True and not user.is_active:
            self._assert_seat_free()

        self.assert_company_fk(Branch, data.branch_id, label="Branch")
        old_role = user.role.name if user.role else None
        was_active = user.is_active
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(user, field, val)
            if was_active and data.is_active is False:
                self._log(user, "user.remove")
            elif not was_active and data.is_active is True:
                self._log(user, "user.restore")
            if new_role is not None and new_role.name != old_role:
                self._log(user, "user.role_change", f"{old_role or 'none'} → {new_role.name}")
        self.db.refresh(user)
        return self._safe(user)
