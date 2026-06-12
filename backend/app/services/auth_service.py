"""AuthService — authentication + account self-service (Phase 3, sensitive group).

Wraps login / refresh / signup / Google OAuth / me / password / profile. Uses the
shared subscription helpers (services/subscription.py) and the security helpers
(core/security) rather than reimplementing them, so the feature-cache and
entitlement logic is untouched.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt as pyjwt
import pyotp
from sqlalchemy.orm import Session

from ..core.exceptions import (
    AppException,
    BadRequestError,
    ConflictError,
    NotConfiguredError,
    PermissionDeniedError,
    TooManyRequestsError,
    UnauthorizedError,
)
from ..core.ratelimit import (
    clear_login_failures,
    is_locked_out,
    register_login_failure,
)
from ..core.config import settings
from ..core.crypto import decrypt_str, encrypt_str
from ..core.passwords import validate_password_strength
from ..core.security import (
    blocklist_access_token,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_user_features,
    hash_password,
    mfa_enrollment_pending,
    verify_password,
)
from ..models.auth_session import AuthSession
from ..models.base import now_utc
from ..models.password_reset import PasswordResetToken
from ..models.company import Branch, Company
from ..models.subscription import Subscription
from ..models.user import Role, User
from ..schemas.auth import MfaChallengeResponse, TokenResponse
from ..services.activity import log_activity
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

logger = logging.getLogger("ricemill.auth")


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_backup_code(code: str) -> str:
    """Lowercase and strip formatting so 'A1B2-C3D4' matches 'a1b2c3d4'."""
    return "".join(ch for ch in code.lower() if ch.isalnum())


def _generate_backup_codes(n: int = 10) -> tuple[list[str], list[str]]:
    """Return (raw codes shown once, SHA-256 hashes to store). Each code is
    64 bits of entropy, grouped for readability (xxxx-xxxx-xxxx-xxxx)."""
    raw, hashes = [], []
    for _ in range(n):
        h = secrets.token_hex(8)
        code = f"{h[0:4]}-{h[4:8]}-{h[8:12]}-{h[12:16]}"
        raw.append(code)
        hashes.append(_sha256(_normalize_backup_code(code)))
    return raw, hashes


class AuthService(BaseService):
    def __init__(self, db: Session, current_user: Any = None) -> None:
        super().__init__(db, current_user)

    # ── token / session helpers ───────────────────────────────────────────────

    def _issue_tokens(self, user: User, *, family_id: uuid.UUID | None = None) -> TokenResponse:
        """Create an AuthSession row and mint the token pair bound to it.

        The refresh token's ``jti`` IS the session row id (stateful, revocable);
        the access token carries ``sid`` = the session family so logout can
        revoke the whole chain from just an access token. Flushes only — the
        caller owns the surrounding transaction.
        """
        session = AuthSession(
            id=uuid.uuid4(),
            family_id=family_id or uuid.uuid4(),
            user_id=user.id,
            expires_at=now_utc() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
        self.db.add(session)
        self.db.flush()
        payload = {**self._full_payload(user), "sid": str(session.family_id)}
        return TokenResponse(
            access_token=create_access_token(payload),
            refresh_token=create_refresh_token(payload, jti=str(session.id)),
        )

    def _log_security_event(self, user: User, action: str, detail: str | None = None) -> None:
        """Record an auth/security event (security hardening P2.15).

        Company users get an activity-log row (visible in Settings); platform
        admins have no company so they get an application-log line only. Never
        log credentials or tokens here. Does NOT commit — call inside a
        transaction (or wrap in one for failure paths that raise afterwards)."""
        logger.info("security event %s user=%s", action, user.username)
        if user.company_id:
            log_activity(
                self.db,
                company_id=user.company_id,
                user_id=user.id,
                action=action,
                entity_type="user",
                entity_id=user.id,
                entity_label=user.username,
                detail=detail,
            )

    def _revoke_family(self, family_id: uuid.UUID) -> None:
        """Revoke every live session in a refresh chain. Flush only."""
        self.db.query(AuthSession).filter(
            AuthSession.family_id == family_id,
            AuthSession.revoked_at.is_(None),
        ).update({AuthSession.revoked_at: now_utc()})
        self.db.flush()

    @staticmethod
    def _full_payload(user: User) -> dict:
        return {
            "sub": str(user.id),
            "company_id": str(user.company_id) if user.company_id else None,
            "role": user.role.name if user.role else None,
            "is_platform_admin": user.is_platform_admin,
        }

    # ── login / refresh / logout ──────────────────────────────────────────────

    def login(self, username: str, password: str) -> TokenResponse | MfaChallengeResponse:
        # Account lockout (per-username) sits in front of the per-IP rate limit so
        # a credential-stuffing run spread across many IPs is still bounded.
        if is_locked_out(username):
            raise TooManyRequestsError(
                "Too many failed login attempts for this account. Please try again later."
            )
        user = self.db.query(User).filter(User.username == username).first()
        if not user or not verify_password(password, user.password_hash):
            register_login_failure(username)
            if user is not None:
                with self.transaction():
                    self._log_security_event(user, "auth.login_failed", "Invalid password.")
            raise UnauthorizedError("Invalid credentials")
        if not user.is_active:
            raise PermissionDeniedError("Account disabled")
        if user.company_id and user.company is not None and not user.company.is_active:
            raise PermissionDeniedError(
                "Your company account has been deactivated. Please contact the platform administrator."
            )
        # MFA: the password alone yields only a short-lived challenge token —
        # real tokens are issued by mfa_verify() after a valid TOTP code.
        if user.mfa_enabled:
            return MfaChallengeResponse(challenge_token=self._mfa_challenge_token(user))
        clear_login_failures(username)
        with self.transaction():
            user.last_login = datetime.now(timezone.utc)
            tokens = self._issue_tokens(user)
            self._log_security_event(user, "auth.login")
        return tokens

    # ── MFA (TOTP) ────────────────────────────────────────────────────────────

    @staticmethod
    def _mfa_challenge_token(user: User) -> str:
        """Short-lived single-purpose token proving the password step passed."""
        expire = datetime.now(timezone.utc) + timedelta(minutes=5)
        return pyjwt.encode(
            {"sub": str(user.id), "type": "mfa", "exp": expire},
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )

    @staticmethod
    def _verify_totp(user: User, code: str) -> bool:
        if not user.mfa_secret:
            return False
        secret = decrypt_str(user.mfa_secret)
        if not secret:
            return False
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)

    def _backup_code_matches(self, user: User, code: str) -> bool:
        return _sha256(_normalize_backup_code(code)) in (user.mfa_backup_codes or [])

    def _consume_backup_code(self, user: User, code: str) -> None:
        h = _sha256(_normalize_backup_code(code))
        user.mfa_backup_codes = [c for c in (user.mfa_backup_codes or []) if c != h]

    def mfa_verify(self, challenge_token: str, code: str) -> TokenResponse:
        """Second login step: exchange the challenge token plus a TOTP code OR a
        one-time backup code for real tokens."""
        payload = decode_token(challenge_token)
        if payload.get("type") != "mfa":
            raise UnauthorizedError("Invalid MFA challenge")
        user = self.db.get(User, payload.get("sub"))
        if not user or not user.is_active or not user.mfa_enabled:
            raise UnauthorizedError("Invalid MFA challenge")
        if is_locked_out(user.username):
            raise TooManyRequestsError("Too many failed attempts. Please try again later.")
        via_totp = self._verify_totp(user, code)
        via_backup = (not via_totp) and self._backup_code_matches(user, code)
        if not via_totp and not via_backup:
            # Bad codes count toward the same lockout as bad passwords, so a
            # stolen password can't be parlayed into unlimited code guessing.
            register_login_failure(user.username)
            with self.transaction():
                self._log_security_event(user, "auth.mfa_failed", "Invalid code.")
            raise UnauthorizedError("Invalid authentication code")
        clear_login_failures(user.username)
        with self.transaction():
            if via_backup:
                self._consume_backup_code(user, code)  # single-use
            user.last_login = datetime.now(timezone.utc)
            tokens = self._issue_tokens(user)
            self._log_security_event(
                user, "auth.login", "MFA verified (backup code)." if via_backup else "MFA verified."
            )
        return tokens

    def mfa_enroll(self) -> dict:
        """Begin enrollment: mint a TOTP seed (encrypted at rest), pending until
        the user proves their authenticator works via mfa_enroll_verify()."""
        user = self.current_user
        if user.mfa_enabled:
            raise BadRequestError("MFA is already enabled. Disable it first to re-enroll.")
        secret = pyotp.random_base32()
        with self.transaction():
            user.mfa_secret = encrypt_str(secret)
        uri = pyotp.totp.TOTP(secret).provisioning_uri(
            name=user.username, issuer_name=settings.APP_NAME
        )
        return {"secret": secret, "otpauth_uri": uri}

    def mfa_enroll_verify(self, code: str) -> dict:
        user = self.current_user
        if user.mfa_enabled:
            raise BadRequestError("MFA is already enabled.")
        if not user.mfa_secret:
            raise BadRequestError("No enrollment in progress. Start enrollment first.")
        if not self._verify_totp(user, code):
            raise BadRequestError("Invalid authentication code. Check your authenticator app.")
        raw_codes, hashes = _generate_backup_codes()
        with self.transaction():
            user.mfa_enabled = True
            user.mfa_backup_codes = hashes
            self._log_security_event(user, "auth.mfa_enabled")
        # Backup codes are shown exactly once here.
        return {"message": "MFA enabled", "backup_codes": raw_codes}

    def regenerate_backup_codes(self, code: str) -> dict:
        """Issue a fresh set of backup codes (invalidating the old ones).
        Requires a current TOTP code to authorize."""
        user = self.current_user
        if not user.mfa_enabled:
            raise BadRequestError("MFA is not enabled.")
        if not self._verify_totp(user, code):
            raise BadRequestError("Invalid authentication code.")
        raw_codes, hashes = _generate_backup_codes()
        with self.transaction():
            user.mfa_backup_codes = hashes
            self._log_security_event(user, "auth.mfa_backup_regenerated")
        return {"backup_codes": raw_codes}

    def mfa_disable(self, code: str) -> dict:
        user = self.current_user
        if not user.mfa_enabled:
            raise BadRequestError("MFA is not enabled.")
        if not self._verify_totp(user, code):
            raise BadRequestError("Invalid authentication code.")
        with self.transaction():
            user.mfa_enabled = False
            user.mfa_secret = None
            user.mfa_backup_codes = None
            self._log_security_event(user, "auth.mfa_disabled")
        return {"message": "MFA disabled"}

    def refresh(self, refresh_token: str) -> TokenResponse:
        """Rotate the refresh token: revoke the presented one, issue a successor.

        Reuse of an already-rotated (revoked) token is treated as theft — the
        entire family is revoked, forcing a fresh login on every device that
        held a token from this chain.
        """
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise UnauthorizedError("Invalid refresh token")
        jti = payload.get("jti")
        session = self.db.get(AuthSession, jti) if jti else None
        if session is None:
            raise UnauthorizedError("Invalid refresh token")
        if session.revoked_at is not None:
            # Rotation-reuse detected: someone replayed an old refresh token.
            with self.transaction():
                self._revoke_family(session.family_id)
            raise UnauthorizedError("Refresh token reuse detected — please log in again")
        if session.expires_at <= now_utc():
            raise UnauthorizedError("Refresh token expired")
        user = self.db.get(User, session.user_id)
        if not user or not user.is_active:
            raise UnauthorizedError("User not found or inactive")
        if user.company_id and user.company is not None and not user.company.is_active:
            raise PermissionDeniedError("Your company account has been deactivated.")
        with self.transaction():
            session.revoked_at = now_utc()
            tokens = self._issue_tokens(user, family_id=session.family_id)
            session.replaced_by = uuid.UUID(decode_token(tokens.refresh_token)["jti"])
        return tokens

    def logout(self, raw_access: str | None, raw_refresh: str | None) -> dict:
        """Revoke the session families behind the presented tokens and blocklist
        the live access token, so logout is a real security event (not a
        client-side wipe).

        Tolerant by design: invalid/expired tokens are skipped rather than
        rejected — an expired access token must not prevent revoking a still-live
        refresh session. Holding a token is sufficient authorization to revoke it.
        """
        families: set[uuid.UUID] = set()
        for raw in (raw_access, raw_refresh):
            if not raw:
                continue
            try:
                payload = decode_token(raw)
            except Exception:
                continue  # expired/garbled — nothing to revoke from this one
            if payload.get("type") == "access":
                blocklist_access_token(payload)
                if payload.get("sid"):
                    families.add(uuid.UUID(payload["sid"]))
            elif payload.get("type") == "refresh" and payload.get("jti"):
                session = self.db.get(AuthSession, payload["jti"])
                if session is not None:
                    families.add(session.family_id)
        if families:
            with self.transaction():
                for fid in families:
                    self._revoke_family(fid)
        return {"message": "Logged out successfully"}

    # ── signup ────────────────────────────────────────────────────────────────

    def signup(self, data) -> TokenResponse:
        validate_password_strength(data.password)
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
            self.db.flush()
            tokens = self._issue_tokens(user)
        return tokens

    # ── Google OAuth ──────────────────────────────────────────────────────────

    def google_auth(self, data) -> TokenResponse | MfaChallengeResponse:
        if id_token is None or not settings.GOOGLE_CLIENT_ID:
            raise NotConfiguredError("Google authentication is not configured on the server")
        try:
            id_info = id_token.verify_oauth2_token(
                data.credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID
            )
        except Exception:
            # Log the real reason server-side; never echo library internals to
            # the client (they can reveal clock skew, audience config, etc.).
            logger.warning("Google token verification failed", exc_info=True)
            raise BadRequestError("Invalid Google credential")

        email = id_info.get("email")
        full_name = id_info.get("name")
        user = self.db.query(User).filter(User.email == email).first()

        if user:
            if not user.is_active:
                raise PermissionDeniedError("Account disabled")
            if user.company_id and user.company is not None and not user.company.is_active:
                raise PermissionDeniedError("Your company account has been deactivated.")
            # A verified Google identity proves the first factor only — an
            # MFA-enabled account must still pass the TOTP challenge.
            if user.mfa_enabled:
                return MfaChallengeResponse(challenge_token=self._mfa_challenge_token(user))
            with self.transaction():
                user.last_login = datetime.now(timezone.utc)
                tokens = self._issue_tokens(user)
            return tokens
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
                self.db.flush()
                tokens = self._issue_tokens(user)
            return tokens

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

        is_privileged = user.is_platform_admin or (user.role and user.role.name == "owner")
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
            "mfa_enabled": user.mfa_enabled,
            "mfa_backup_codes_remaining": len(user.mfa_backup_codes or []) if user.mfa_enabled else 0,
            # High-privilege accounts (platform admin / owner) should enroll in
            # MFA — the UI uses this to prompt until they do.
            "mfa_setup_recommended": bool(is_privileged and not user.mfa_enabled),
            # Hard gate: when true, enforcement is on and the API blocks data
            # endpoints until this user enrolls. The web app shows a mandatory
            # enrollment screen.
            "mfa_enrollment_required": mfa_enrollment_pending(user),
        }

    # ── password reset ────────────────────────────────────────────────────────

    def request_password_reset(self, identifier: str) -> dict:
        """Issue a reset token for the account matching ``identifier`` (username
        or email). Enumeration-safe: the response is identical whether or not an
        account matched, so it can't be used to probe which emails are registered.

        With no email provider wired up, the reset link is logged server-side;
        in dev (EXPOSE_RESET_TOKEN) the raw token is also returned for testing.
        """
        ident = identifier.strip()
        user = (
            self.db.query(User)
            .filter((User.username == ident) | (User.email == ident))
            .first()
        )
        exposed_token: str | None = None
        if user is not None:
            raw = secrets.token_urlsafe(32)
            with self.transaction():
                # Invalidate any outstanding tokens for this user first.
                self.db.query(PasswordResetToken).filter(
                    PasswordResetToken.user_id == user.id,
                    PasswordResetToken.used_at.is_(None),
                ).update({PasswordResetToken.used_at: now_utc()})
                self.db.add(
                    PasswordResetToken(
                        user_id=user.id,
                        token_hash=_sha256(raw),
                        expires_at=now_utc() + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_MINUTES),
                    )
                )
                self._log_security_event(user, "auth.password_reset_requested")
            link = f"{settings.FRONTEND_BASE_URL}/reset-password?token={raw}"
            logger.info("Password reset link for %s: %s", user.username, link)
            if settings.EXPOSE_RESET_TOKEN:
                exposed_token = raw
        resp = {"message": "If an account matches, a reset link has been sent."}
        if exposed_token is not None:
            resp["reset_token"] = exposed_token  # dev only
        return resp

    def reset_password(self, token: str, new_password: str) -> dict:
        """Consume a reset token and set a new password. Revokes all sessions."""
        row = (
            self.db.query(PasswordResetToken)
            .filter(PasswordResetToken.token_hash == _sha256(token.strip()))
            .first()
        )
        if row is None or row.used_at is not None or row.expires_at <= now_utc():
            raise BadRequestError("This reset link is invalid or has expired.")
        validate_password_strength(new_password)
        user = self.db.get(User, row.user_id)
        if user is None:
            raise BadRequestError("This reset link is invalid or has expired.")
        with self.transaction():
            user.password_hash = hash_password(new_password)
            row.used_at = now_utc()
            # A reset is a credential change — kill every existing session.
            self.db.query(AuthSession).filter(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(user, "auth.password_reset", "All sessions revoked.")
        return {"message": "Password has been reset. Please log in."}

    def change_password(self, data) -> dict:
        if not verify_password(data.current_password, self.current_user.password_hash):
            raise BadRequestError("Current password is incorrect")
        validate_password_strength(data.new_password)
        with self.transaction():
            self.current_user.password_hash = hash_password(data.new_password)
            # Kill every refresh session for this user: a password change must
            # invalidate any token a previous holder (or thief) still has.
            self.db.query(AuthSession).filter(
                AuthSession.user_id == self.current_user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(
                self.current_user, "auth.password_changed", "All sessions revoked."
            )
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
