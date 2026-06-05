"""AuthService — authentication + account self-service (Phase 3, sensitive group).

Wraps login / refresh / signup / Google OAuth / me / password / profile. Uses the
shared subscription helpers (services/subscription.py) and the security helpers
(core/security) rather than reimplementing them, so the feature-cache and
entitlement logic is untouched.
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import (
    AppException,
    BadRequestError,
    ConflictError,
    NotConfiguredError,
    PermissionDeniedError,
    UnauthorizedError,
)
from ..core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_user_features,
    hash_password,
    verify_password,
)
from ..models.company import Branch, Company
from ..models.subscription import Subscription
from ..models.user import Role, User
from ..schemas.auth import TokenResponse
from ..services.base import BaseService
from ..services.subscription import (
    auto_downgrade_to_free_if_expired,
    effective_status,
    ensure_subscription,
)

try:
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token
except ImportError:  # google-auth not installed — Google login disabled
    id_token = None  # type: ignore[assignment]
    google_requests = None  # type: ignore[assignment]


class AuthService(BaseService):
    def __init__(self, db: Session, current_user: Any = None) -> None:
        super().__init__(db, current_user)

    # ── token helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _tokens(payload: dict) -> TokenResponse:
        return TokenResponse(
            access_token=create_access_token(payload),
            refresh_token=create_refresh_token(payload),
        )

    @staticmethod
    def _full_payload(user: User) -> dict:
        return {
            "sub": str(user.id),
            "company_id": str(user.company_id) if user.company_id else None,
            "role": user.role.name if user.role else None,
            "is_platform_admin": user.is_platform_admin,
        }

    # ── login / refresh ───────────────────────────────────────────────────────

    def login(self, username: str, password: str) -> TokenResponse:
        user = self.db.query(User).filter(User.username == username).first()
        if not user or not verify_password(password, user.password_hash):
            raise UnauthorizedError("Invalid credentials")
        if not user.is_active:
            raise PermissionDeniedError("Account disabled")
        if user.company_id and user.company is not None and not user.company.is_active:
            raise PermissionDeniedError(
                "Your company account has been deactivated. Please contact the platform administrator."
            )
        with self.transaction():
            user.last_login = datetime.now(timezone.utc)
        return self._tokens(self._full_payload(user))

    def refresh(self, refresh_token: str) -> TokenResponse:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise UnauthorizedError("Invalid refresh token")
        clean = {k: v for k, v in payload.items() if k not in ("exp", "type")}
        return self._tokens(clean)

    # ── signup ────────────────────────────────────────────────────────────────

    def signup(self, data) -> TokenResponse:
        if len(data.password) < 8:
            raise BadRequestError("Password must be at least 8 characters")
        if self.db.query(User).filter(User.username == data.username).first():
            raise ConflictError("Username already taken")
        if self.db.query(User).filter(User.email == data.email).first():
            raise ConflictError("Email already registered")
        owner_role = self.db.query(Role).filter_by(name="owner").first()
        if not owner_role:
            raise AppException("System not initialized. Run seed.py to create roles.")

        with self.transaction():
            company = Company(name=data.company_name, is_multi_branch=data.is_multi_branch)
            self.db.add(company)
            self.db.flush()
            branch = Branch(company_id=company.id, name=data.company_name, is_main_branch=True)
            self.db.add(branch)
            self.db.flush()
            if ensure_subscription(self.db, company.id) is None:
                raise AppException("System not initialized — Free plan missing. Run alembic migrations.")
            user = User(
                company_id=company.id,
                branch_id=branch.id,
                username=data.username,
                email=data.email,
                full_name=data.full_name,
                password_hash=hash_password(data.password),
                role_id=owner_role.id,
            )
            self.db.add(user)
        self.db.refresh(user)
        return self._tokens(
            {"sub": str(user.id), "company_id": str(user.company_id), "role": "owner"}
        )

    # ── Google OAuth ──────────────────────────────────────────────────────────

    def google_auth(self, data) -> TokenResponse:
        from ..core.config import settings

        if id_token is None or not settings.GOOGLE_CLIENT_ID:
            raise NotConfiguredError("Google authentication is not configured on the server")
        try:
            id_info = id_token.verify_oauth2_token(
                data.credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID
            )
        except Exception as e:
            raise BadRequestError(f"Invalid Google token: {str(e)}")

        email = id_info.get("email")
        full_name = id_info.get("name")
        user = self.db.query(User).filter(User.email == email).first()

        if user:
            if not user.is_active:
                raise PermissionDeniedError("Account disabled")
            if user.company_id and user.company is not None and not user.company.is_active:
                raise PermissionDeniedError("Your company account has been deactivated.")
            with self.transaction():
                user.last_login = datetime.now(timezone.utc)
        else:
            if not data.company_name:
                raise BadRequestError("Company name is required for new accounts via Google")
            owner_role = self.db.query(Role).filter_by(name="owner").first()
            if not owner_role:
                raise AppException("System not initialized.")
            with self.transaction():
                company = Company(name=data.company_name, is_multi_branch=data.is_multi_branch)
                self.db.add(company)
                self.db.flush()
                branch = Branch(company_id=company.id, name=data.company_name, is_main_branch=True)
                self.db.add(branch)
                self.db.flush()
                if ensure_subscription(self.db, company.id) is None:
                    raise AppException("System not initialized — Free plan missing.")
                random_password = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(32))
                base_username = email.split("@")[0]
                username = base_username
                counter = 1
                while self.db.query(User).filter(User.username == username).first():
                    username = f"{base_username}{counter}"
                    counter += 1
                user = User(
                    company_id=company.id,
                    branch_id=branch.id,
                    username=username,
                    email=email,
                    full_name=full_name,
                    password_hash=hash_password(random_password),
                    role_id=owner_role.id,
                )
                self.db.add(user)
            self.db.refresh(user)
        return self._tokens(self._full_payload(user))

    # ── account self-service ──────────────────────────────────────────────────

    def me(self) -> dict:
        user = self.current_user
        if user.company_id and not user.is_platform_admin:
            ensure_subscription(self.db, user.company_id)
            auto_downgrade_to_free_if_expired(self.db, user.company_id)
            self.db.commit()

        features = get_user_features(user, self.db)

        plan_info = None
        if user.company_id and not user.is_platform_admin:
            sub = self.db.query(Subscription).filter(Subscription.company_id == user.company_id).first()
            if sub and sub.plan:
                plan_info = {
                    "code": sub.plan.code,
                    "name": sub.plan.name,
                    "monthly_price": float(sub.plan.monthly_price),
                    "max_users": sub.plan.max_users,
                    "max_branches": sub.plan.max_branches,
                    "status": effective_status(sub) or sub.status,
                    "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
                }

        return {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role.name if user.role else None,
            "company_id": str(user.company_id) if user.company_id else None,
            "branch_id": str(user.branch_id) if user.branch_id else None,
            "is_platform_admin": user.is_platform_admin,
            "subscription": plan_info,
            "features": features,
        }

    def change_password(self, data) -> dict:
        if not verify_password(data.current_password, self.current_user.password_hash):
            raise BadRequestError("Current password is incorrect")
        if len(data.new_password) < 8:
            raise BadRequestError("New password must be at least 8 characters")
        with self.transaction():
            self.current_user.password_hash = hash_password(data.new_password)
        return {"message": "Password changed successfully"}

    def update_profile(self, data) -> dict:
        with self.transaction():
            if data.full_name is not None:
                self.current_user.full_name = data.full_name
            if data.email is not None and data.email != self.current_user.email:
                clash = (
                    self.db.query(User)
                    .filter(User.email == data.email, User.id != self.current_user.id)
                    .first()
                )
                if clash:
                    raise ConflictError("Email already in use")
                self.current_user.email = data.email
        return {"message": "Profile updated"}
