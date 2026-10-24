"""UserService — business logic for the users domain (Phase 3).

Includes the plan user-limit gate (402) enforced on creation.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.access_policy import access_for_role, access_for_user, custom_role_access, within
from ..core.exceptions import BadRequestError, FeatureRequiredError, NotFoundError, PermissionDeniedError
from ..core.passwords import validate_password_strength
from ..core.security import hash_password
from ..models.company import Branch, Company
from ..models.subscription import Subscription
from ..models.user import CompanyRole, Role, User
from ..repositories.users import UserRepository
from ..schemas.users import UserResponse
from ..services.activity import log_activity
from ..services.base import BaseService

# Making someone a Boss or an Admin hands over control of the mill, so it asks
# the person doing it to confirm: their own password, and an authenticator code
# if they use one. So does any role that can manage the people (Users, with edit).
CONFIRMED_ROLES = {"owner", "admin"}
# What the app calls the built-in roles (packages/shared ROLES).
ROLE_LABELS = {
    "owner": "Boss",
    "admin": "Admin",
    "accountant": "Accountant",
    "cashier": "Cashier",
    "mill_operator": "Mill operator",
    "encoder": "Encoder",
}


class _Chosen:
    """The role someone is being given: built in, or one the Boss made up."""

    def __init__(self, role: Role | None = None, custom: CompanyRole | None = None) -> None:
        self.role = role
        self.custom = custom

    @property
    def name(self) -> str:
        """For the activity log: a built-in role by its own name, as before."""
        if self.custom is not None:
            return self.custom.name
        return self.role.name if self.role else "none"

    @property
    def label(self) -> str:
        """For people: what the app calls the role."""
        if self.custom is not None:
            return self.custom.name
        return ROLE_LABELS.get(self.role.name, self.role.name) if self.role else "none"


def _clean_email(raw: Any) -> str | None:
    """An email as typed, tidied: blank is no email at all. Stored as "", it
    clashed with the next account added without one (emails are unique)."""
    cleaned = str(raw).strip() if raw is not None else ""
    return cleaned or None


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
        # role must exist (built-in roles are a small global table; a made-up
        # one must be this mill's).
        self.assert_company_fk(Branch, data.branch_id, label="Branch")
        if (data.role_id is None) == (data.custom_role_id is None):
            raise BadRequestError("Choose a role.")
        chosen = self._chosen(data.role_id, data.custom_role_id)
        self._assert_may_give(chosen)

        email = _clean_email(data.email)
        self._assert_email_free(email)

        self._assert_seat_free()
        if self._needs_confirming(chosen):
            self._confirm_actor(data, f"Made {data.username} a {chosen.name}")

        user = User(
            company_id=self.current_user.company_id,
            branch_id=data.branch_id,
            username=data.username,
            email=email,
            password_hash=hash_password(data.password),
            full_name=data.full_name,
            role_id=data.role_id,
            custom_role_id=data.custom_role_id,
        )
        with self.transaction():
            self.users.add(user)
            self.db.flush()
            self._log(user, "user.create", f"Role: {chosen.name}")
        self.db.refresh(user)
        return self._safe(user)

    def _confirm_actor(self, data, reason: str) -> None:
        from .auth_service import AuthService

        AuthService(self.db, self.current_user).confirm_identity(data.current_password, data.mfa_code, reason=reason)

    def _assert_email_free(self, email: str | None, *, keep: User | None = None) -> None:
        """Every account's email is its own: say so, rather than fail on the
        database's unique rule."""
        if email is None:
            return
        taken = self.db.query(User).filter(func.lower(User.email) == email.lower()).first()
        if taken is not None and taken is not keep:
            raise BadRequestError("That email is already used by another account.")

    def _editor_is_owner(self) -> bool:
        return bool(self.current_user.role and self.current_user.role.name == "owner")

    def _chosen(self, role_id: int | None, custom_role_id: uuid.UUID | None) -> _Chosen:
        if custom_role_id is not None:
            custom = self.db.get(CompanyRole, custom_role_id)
            if custom is None or custom.company_id != self.current_user.company_id:
                raise BadRequestError("Invalid role")
            return _Chosen(custom=custom)
        role = self.db.get(Role, role_id) if role_id is not None else None
        if role is None:
            raise BadRequestError("Invalid role")
        return _Chosen(role=role)

    def _access_of(self, chosen: _Chosen) -> dict[str, str]:
        """What a role opens in this mill, as its Boss has set it."""
        if chosen.custom is not None:
            return custom_role_access(chosen.custom.access)
        company = self.db.get(Company, self.current_user.company_id)
        return access_for_role(chosen.role.name if chosen.role else None, company.role_access if company else None)

    def _assert_may_give(self, chosen: _Chosen) -> None:
        """Only the Boss makes a Boss, and nobody else can give a role that opens
        more than they have themselves: opening Users to someone lets them run
        the staff, not hand themselves (or a friend) the mill."""
        if self._editor_is_owner():
            return
        if chosen.role is not None and chosen.role.name == "owner":
            raise PermissionDeniedError("Only the Boss can make someone a Boss.")
        if not within(self._access_of(chosen), access_for_user(self.current_user)):
            raise PermissionDeniedError(
                f"The {chosen.label} role can open more than you can, so only the Boss can give it."
            )

    def _assert_may_manage(self, user: User) -> None:
        """Nobody but the Boss changes the account of someone who can open more
        than they can (an Admin, for one, when an Accountant runs the Users page)."""
        if self._editor_is_owner() or user.id == self.current_user.id:
            return
        if user.role and user.role.name == "owner":
            raise PermissionDeniedError("Only the Boss can change a Boss account.")
        if not within(access_for_user(user), access_for_user(self.current_user)):
            raise PermissionDeniedError("This person can open more than you can, so only the Boss can change them.")

    def _needs_confirming(self, chosen: _Chosen) -> bool:
        if chosen.role is not None and chosen.role.name in CONFIRMED_ROLES:
            return True
        return self._access_of(chosen).get("users") == "full"

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
        if data.role_id is not None and data.custom_role_id is not None:
            raise BadRequestError("Choose one role.")
        # The role being given, when it's a change: the edit form always sends the role.
        change: _Chosen | None = None
        if data.role_id is not None or data.custom_role_id is not None:
            chosen = self._chosen(data.role_id, data.custom_role_id)
            if (chosen.role is not None and (user.custom_role_id is not None or chosen.role.id != user.role_id)) or (
                chosen.custom is not None and chosen.custom.id != user.custom_role_id
            ):
                change = chosen

        # Your own account can't be removed, and you can't change your own role
        # (an owner demoting themselves could leave the mill without one).
        if user.id == self.current_user.id:
            if data.is_active is False:
                raise BadRequestError("You can't remove your own account.")
            if change is not None:
                raise BadRequestError("You can't change your own role.")

        # Owners (shown as "Boss") outrank everyone: only an owner can edit or
        # remove an owner, or make someone an owner; and nobody else changes
        # someone who can open more than they can, or gives a role that does.
        self._assert_may_manage(user)
        if change is not None:
            self._assert_may_give(change)

        # Restoring a removed user takes a seat again.
        if data.is_active is True and not user.is_active:
            self._assert_seat_free()

        self.assert_company_fk(Branch, data.branch_id, label="Branch")
        old_role = user.custom_role.name if user.custom_role else user.role.name if user.role else None
        was_active = user.is_active
        # Becoming a Boss or an Admin is confirmed like creating one. An unchanged
        # role (the edit form always sends it) is not.
        if change is not None and self._needs_confirming(change):
            self._confirm_actor(data, f"Made {user.username} a {change.name}")
        # Sent blank, the email is taken off; left out, it stays as it is.
        new_email = _clean_email(data.email) if data.email is not None else user.email
        email_changed = data.email is not None and (new_email or "").lower() != (user.email or "").strip().lower()
        if email_changed:
            self._assert_email_free(new_email, keep=user)
        with self.transaction():
            # The confirmation fields are not account fields, and the role and email are set below.
            exclude = {"current_password", "mfa_code", "role_id", "custom_role_id", "email"}
            for field, val in data.model_dump(exclude_none=True, exclude=exclude).items():
                setattr(user, field, val)
            if email_changed:
                user.email = new_email
            if change is not None:
                # One or the other: a built-in role, or one the Boss made up.
                user.role_id = change.role.id if change.role is not None else None
                user.custom_role_id = change.custom.id if change.custom is not None else None
            if email_changed:
                # A new address is unproven until its owner confirms it, here as
                # on the profile page: a verified email is what lets an owner load
                # a backup into a new account (services/data_backup.py).
                user.email_verified = False
                user.email_verification_hash = None
                user.email_verification_expires = None
            if was_active and data.is_active is False:
                self._log(user, "user.remove")
            elif not was_active and data.is_active is True:
                self._log(user, "user.restore")
            if change is not None:
                self._log(user, "user.role_change", f"{old_role or 'none'} → {change.name}")
        self.db.refresh(user)
        return self._safe(user)
