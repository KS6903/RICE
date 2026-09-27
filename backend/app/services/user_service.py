"""UserService — business logic for the users domain (Phase 3).

Includes the plan user-limit gate (402) enforced on creation.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, FeatureRequiredError, NotFoundError
from ..core.passwords import validate_password_strength
from ..core.security import hash_password
from ..models.company import Branch
from ..models.subscription import Subscription
from ..models.user import Role, User
from ..repositories.users import UserRepository
from ..schemas.users import UserResponse
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
        if data.role_id is not None and self.db.get(Role, data.role_id) is None:
            raise BadRequestError("Invalid role")

        existing_count = self.users.count_for_company(self.current_user.company_id)
        sub = self.db.query(Subscription).filter(Subscription.company_id == self.current_user.company_id).first()
        if sub and sub.plan and sub.plan.max_users is not None and existing_count >= sub.plan.max_users:
            raise FeatureRequiredError(
                f"Your plan allows up to {sub.plan.max_users} users. Please upgrade to add more.",
                code="user_limit",
            )

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
        self.db.refresh(user)
        return self._safe(user)

    def update_user(self, user_id: uuid.UUID, data) -> UserResponse:
        user = self.users.get_for_company(user_id, self.current_user.company_id)
        if not user:
            raise NotFoundError("User not found")
        self.assert_company_fk(Branch, data.branch_id, label="Branch")
        if data.role_id is not None and self.db.get(Role, data.role_id) is None:
            raise BadRequestError("Invalid role")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(user, field, val)
        self.db.refresh(user)
        return self._safe(user)
