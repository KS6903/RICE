"""AuthService — authentication + account self-service (Phase 3, sensitive group).

Wraps login / refresh / signup / Google OAuth / me / password / profile. Uses the
shared subscription helpers (services/subscription.py) and the security helpers
(core/security) rather than reimplementing them, so the feature-cache and
entitlement logic is untouched.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import string
import uuid
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import jwt as pyjwt
import pyotp
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..core import legal as legal_docs
from ..core import provisioning, turnstile
from ..core.account_status import describe_account, sign_in_refusal
from ..core.config import settings
from ..core.cookies import describe_session_cookies
from ..core.crypto import decrypt_str, encrypt_str
from ..core.devices import describe_device
from ..core.email import send_account_email
from ..core.exceptions import (
    AppException,
    BadRequestError,
    ConflictError,
    NotConfiguredError,
    NotFoundError,
    PermissionDeniedError,
    ServiceUnavailableError,
    TooManyRequestsError,
    UnauthorizedError,
)
from ..core.mfa_trust import local_zone, next_reset_at
from ..core.passwords import generate_temporary_password, validate_password_strength
from ..core.platform_admin import is_managed as is_cloudflare_admin
from ..core.platform_admin import password_hash_for
from ..core.ratelimit import (
    LockoutState,
    clear_login_failures,
    client_ip,
    first_lockout_help_request,
    login_lockout,
    register_login_failure,
)
from ..core.security import (
    blocklist_access_token,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_user_features,
    hash_password,
    mfa_enrollment_pending,
    mfa_is_mandatory,
    password_change_pending,
    verify_password,
)
from ..core.tenancy import (
    provision_tenant,
    schema_name_for,
    set_search_path,
)
from ..models.auth_session import AuthSession
from ..models.base import now_utc
from ..models.company import Branch, Company
from ..models.password_reset import PasswordResetToken
from ..models.subscription import Subscription
from ..models.user import Role, User
from ..schemas.auth import MfaChallengeResponse, TokenResponse
from ..services.activity import log_activity
from ..services.base import BaseService
from ..services.legal_service import LegalService
from ..services.notification_service import unread_count_column
from ..services.subscription import (
    downgrade_if_expired,
    effective_status,
    ensure_subscription,
)
from . import platform_emails

# Imported independently so a missing transport (e.g. the `requests` extra) can't
# also null out id_token, and vice versa — both are checked before use below.
try:
    from google.oauth2 import id_token
except ImportError:  # google-auth not installed — Google login disabled
    id_token = None  # type: ignore[assignment]
try:
    from google.auth.transport import requests as google_requests
except ImportError:  # requests transport missing — Google login disabled
    google_requests = None  # type: ignore[assignment]

logger = logging.getLogger("ricemill.auth")

# Client schemas seen to have a notifications table, in this process. A schema
# not migrated yet may lack it; until one is seen, the unread count goes through
# a savepoint so a missing table can't fail /auth/me. Tables are never dropped,
# so once seen, the count joins the one account query.
_SCHEMAS_WITH_NOTIFICATIONS: set[str] = set()
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_backup_code(code: str) -> str:
    """Lowercase and strip formatting so 'A1B2-C3D4' matches 'a1b2c3d4'."""
    return "".join(ch for ch in code.lower() if ch.isalnum())


def _client_label(user_agent: str | None) -> str:
    """A short, human-recognizable device label from a User-Agent string."""
    if not user_agent:
        return "Unknown device"
    ua = user_agent
    if "Electron" in ua:
        return "Desktop app"
    if "Edg" in ua:
        browser = "Edge"
    elif "Firefox" in ua:
        browser = "Firefox"
    elif "Chrome" in ua and "Chromium" not in ua:
        browser = "Chrome"
    elif "Safari" in ua:
        browser = "Safari"
    else:
        browser = "Browser"
    if "Windows" in ua:
        os_name = "Windows"
    elif "Mac OS" in ua or "Macintosh" in ua:
        os_name = "macOS"
    elif "Android" in ua:
        os_name = "Android"
    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"
    elif "Linux" in ua:
        os_name = "Linux"
    else:
        os_name = ""
    return f"{browser} · {os_name}" if os_name else browser


def _mfa_fingerprint(user: User) -> str:
    """What "remember this device" tokens are bound to: the current secret and epoch."""
    return _sha256(f"{user.mfa_secret or ''}:{user.mfa_epoch or 0}")[:16]


def has_previous_mfa_secret(user: User) -> bool:
    """True when MFA is off but the authenticator the user turned off is still on
    file, so they can switch back on with a fresh code from it. A pending
    enrollment also has a secret, but its code was never accepted (see the
    ``mfa_last_used_step`` note on the model), so it doesn't count."""
    return bool(user.mfa_secret) and not user.mfa_enabled and user.mfa_last_used_step is not None


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


def _format_duration(seconds: int) -> str:
    """A short human phrase for a wait time, e.g. '45 seconds', '5 minutes', '2 hours'."""
    if seconds < 60:
        n, unit = max(1, seconds), "second"
    elif seconds < 3600:
        n, unit = round(seconds / 60), "minute"
    else:
        n, unit = round(seconds / 3600), "hour"
    return f"{n} {unit}{'s' if n != 1 else ''}"


def _lockout_error(state: LockoutState) -> TooManyRequestsError:
    """Turn a locked LockoutState into the 429 the client should see.

    Permanent locks carry code ``account_locked`` and steer the user to a password
    reset; timed locks carry ``account_locked_temporary`` and name the wait."""
    if state.permanent:
        return TooManyRequestsError(
            "This account has been locked after too many failed sign-in attempts. "
            "Reset your password to regain access.",
            code="account_locked",
        )
    return TooManyRequestsError(
        f"Too many failed sign-in attempts. This account is locked for {_format_duration(state.retry_after)}.",
        code="account_locked_temporary",
    )


class AuthService(BaseService):
    def __init__(self, db: Session, current_user: Any = None, client: str | None = None, ip: str | None = None) -> None:
        super().__init__(db, current_user)
        # Raw User-Agent and IP of the request that constructed this service;
        # recorded on any AuthSession it creates so the user can recognize their devices.
        self._client = client
        self._ip = ip

    @staticmethod
    def _validate_signup_invite(invite_code: str | None) -> None:
        if settings.SIGNUP_OPEN:
            return
        required = settings.SIGNUP_INVITE_CODE
        if required is None:
            if settings.is_prod:
                raise PermissionDeniedError("New account registration is unavailable")
            return
        if not invite_code or not secrets.compare_digest(
            invite_code,
            required.get_secret_value(),
        ):
            raise PermissionDeniedError("A valid registration invite is required")

    # ── token / session helpers ───────────────────────────────────────────────

    def _issue_tokens(
        self,
        user: User,
        *,
        family_id: uuid.UUID | None = None,
        family_expires_at: datetime | None = None,
    ) -> TokenResponse:
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
            client=_client_label(self._client),
            ip_address=self._ip[:45] if self._ip else None,
            user_agent=self._client[:512] if self._client else None,
            # Rotation preserves the original family's absolute expiry rather
            # than extending a stolen refresh token forever.
            expires_at=family_expires_at or now_utc() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
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
            # Auth flows (login/logout/reset) run on a public-scoped session, but
            # activity_logs is a per-client table — point the session at the user's
            # schema first. search_path keeps `public` too, so AuthSession and other
            # control-plane writes in the same transaction still resolve.
            if user.company is not None:
                set_search_path(self.db, schema_name_for(user.company))
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
            # Tenant routing: the client schema this user's requests run against.
            # None for platform admins (they operate on public + loop schemas).
            "schema": user.company.schema_name if user.company else None,
            "role": user.role.name if user.role else None,
            "is_platform_admin": user.is_platform_admin,
        }

    # ── login / refresh / logout ──────────────────────────────────────────────

    def login(
        self, username: str, password: str, mfa_trust_tokens: Sequence[str] = ()
    ) -> TokenResponse | MfaChallengeResponse:
        # Progressive account lockout (per-username) sits in front of the per-IP
        # rate limit so a credential-stuffing run spread across many IPs is still
        # bounded. Each lockout round tightens the threshold and lengthens the wait,
        # ending in a permanent lock that only a password reset clears.
        lock = login_lockout(username)
        if lock.locked:
            raise _lockout_error(lock)
        user = self.db.query(User).filter(User.username == username).first()
        password_matches = verify_password(
            password,
            password_hash_for(user) if user is not None else _DUMMY_PASSWORD_HASH,
        )
        if not user or not password_matches:
            state = register_login_failure(username)
            if user is not None:
                with self.transaction():
                    self._log_security_event(user, "auth.login_failed", "Invalid password.")
            # If that failure tripped the threshold, tell the user they're now
            # locked (and for how long) rather than a generic "invalid credentials",
            # and email the account holder: it may not have been them.
            if state.locked:
                if user is not None:
                    platform_emails.account_locked(user, state)
                raise _lockout_error(state)
            raise UnauthorizedError("Invalid credentials")
        if not user.is_active:
            raise PermissionDeniedError("Account disabled")
        if refusal := sign_in_refusal(user, now=now_utc()):
            raise PermissionDeniedError(refusal)
        if user.must_change_password and user.temp_password_expires_at and user.temp_password_expires_at <= now_utc():
            raise UnauthorizedError("Your temporary password has expired. Ask for a new one.")
        if settings.is_prod and user.company is not None and user.company.provisioned_at is None:
            with self.transaction():
                self._request_tenant_provisioning(user.company)
            raise ServiceUnavailableError("Account setup is in progress. Please try again shortly.")
        # MFA: the password alone yields only a short-lived challenge token —
        # real tokens are issued by mfa_verify() after a valid TOTP code. A
        # device where this account verified MFA within the trust window skips
        # the challenge.
        if user.mfa_enabled and not self._mfa_trusted(user, mfa_trust_tokens):
            return MfaChallengeResponse(challenge_token=self._mfa_challenge_token(user))
        clear_login_failures(username)
        with self.transaction():
            user.last_login = datetime.now(timezone.utc)
            tokens = self._issue_tokens(user)
            self._log_security_event(
                user,
                "auth.login",
                "MFA skipped (trusted device)." if user.mfa_enabled else None,
            )
        return tokens

    # ── MFA (TOTP) ────────────────────────────────────────────────────────────

    @staticmethod
    def _mfa_challenge_token(user: User) -> str:
        """Short-lived single-purpose token proving the password step passed."""
        expire = datetime.now(timezone.utc) + timedelta(minutes=5)
        return pyjwt.encode(
            {
                "sub": str(user.id),
                "type": "mfa",
                "jti": uuid.uuid4().hex,
                "iat": datetime.now(timezone.utc),
                "iss": settings.JWT_ISSUER,
                "aud": settings.JWT_AUDIENCE,
                "exp": expire,
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )

    # ── "Remember this device" (skip MFA until Sunday) ────────────────────────

    @staticmethod
    def _mfa_trust_token(user: User, zone: ZoneInfo) -> str:
        """A device-scoped token (stored as an httpOnly cookie) that lets this
        browser skip the MFA step on login until the next weekly reset — the
        coming Sunday 00:00 in the user's local ``zone``. So every device
        re-prompts once a week, on the user's own Sunday.

        Bound to the user's current MFA secret and epoch via ``mv``, so turning MFA
        off or on, or setting up a new authenticator, invalidates every outstanding
        trust token immediately (the epoch is what covers switching the same
        earlier secret back on)."""
        expire = next_reset_at(zone)
        return pyjwt.encode(
            {
                "sub": str(user.id),
                "type": "mfa_trust",
                "jti": uuid.uuid4().hex,
                "mv": _mfa_fingerprint(user),
                "iat": datetime.now(timezone.utc),
                "iss": settings.JWT_ISSUER,
                "aud": settings.JWT_AUDIENCE,
                "exp": expire,
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )

    @staticmethod
    def _mfa_trusted(user: User, tokens: str | Iterable[str] | None) -> bool:
        """True if any of ``tokens`` is a valid, unexpired MFA-trust token for this
        user that still matches their current MFA secret. A device carries one per
        account that passed 2FA on it; the others' simply don't match. Never
        raises — a bad/expired token just means 'not trusted', so login falls back
        to the MFA challenge."""
        if not tokens or not settings.MFA_TRUST_ENABLED:
            return False
        if isinstance(tokens, str):
            tokens = (tokens,)
        return any(AuthService._trust_token_matches(user, token) for token in tokens)

    @staticmethod
    def _trust_token_matches(user: User, token: str) -> bool:
        try:
            payload = pyjwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM],
                issuer=settings.JWT_ISSUER,
                audience=settings.JWT_AUDIENCE,
                options={"require": ["exp", "iat", "iss", "aud", "type", "jti"]},
            )
        except Exception:
            return False
        return (
            payload.get("type") == "mfa_trust"
            and payload.get("sub") == str(user.id)
            and payload.get("mv") == _mfa_fingerprint(user)
        )

    @staticmethod
    def _matching_totp_step(user: User, code: str) -> int | None:
        """Return an unused matching time-step, or None.

        Checking explicit steps lets us persist the accepted counter and reject
        replay of a code during the same (or an older skew) window.
        """
        if not user.mfa_secret:
            return None
        secret = decrypt_str(user.mfa_secret)
        if not secret:
            return None
        totp = pyotp.TOTP(secret)
        current = int(datetime.now(timezone.utc).timestamp()) // totp.interval
        last = user.mfa_last_used_step
        candidate = code.strip()
        for step in (current - 1, current, current + 1):
            if last is not None and step <= last:
                continue
            if secrets.compare_digest(totp.at(step * totp.interval), candidate):
                return step
        return None

    def _backup_code_matches(self, user: User, code: str) -> bool:
        return _sha256(_normalize_backup_code(code)) in (user.mfa_backup_codes or [])

    def _consume_backup_code(self, user: User, code: str) -> None:
        h = _sha256(_normalize_backup_code(code))
        user.mfa_backup_codes = [c for c in (user.mfa_backup_codes or []) if c != h]

    def mfa_verify(self, challenge_token: str, code: str, browser_zone: str | None = None) -> tuple[TokenResponse, str]:
        """Second login step: exchange the challenge token plus a TOTP code OR a
        one-time backup code for real tokens.

        Returns ``(tokens, mfa_trust_token)`` — the controller stores the trust
        token (httpOnly cookie) so this device skips MFA until the next Sunday
        00:00 in the user's local time: ``browser_zone`` when it is a real IANA
        zone, else their company's zone (see core/mfa_trust.py)."""
        payload = decode_token(challenge_token)
        if payload.get("type") != "mfa":
            raise UnauthorizedError("Invalid MFA challenge")
        user = self.db.query(User).filter(User.id == payload.get("sub")).with_for_update().first()
        if not user or not user.is_active or not user.mfa_enabled:
            raise UnauthorizedError("Invalid MFA challenge")
        lock = login_lockout(user.username)
        if lock.locked:
            raise _lockout_error(lock)
        totp_step = self._matching_totp_step(user, code)
        via_backup = totp_step is None and self._backup_code_matches(user, code)
        if totp_step is None and not via_backup:
            # Bad codes count toward the same progressive lockout as bad passwords,
            # so a stolen password can't be parlayed into unlimited code guessing.
            state = register_login_failure(user.username)
            with self.transaction():
                self._log_security_event(user, "auth.mfa_failed", "Invalid code.")
            if state.locked:
                raise _lockout_error(state)
            raise UnauthorizedError("Invalid authentication code")
        clear_login_failures(user.username)
        with self.transaction():
            if via_backup:
                self._consume_backup_code(user, code)  # single-use
            else:
                user.mfa_last_used_step = totp_step
            user.last_login = datetime.now(timezone.utc)
            tokens = self._issue_tokens(user)
            self._log_security_event(
                user, "auth.login", "MFA verified (backup code)." if via_backup else "MFA verified."
            )
        zone = local_zone(browser_zone, user.company.timezone if user.company is not None else None)
        return tokens, self._mfa_trust_token(user, zone)

    def mfa_enroll(self) -> dict:
        """Begin enrollment: mint a TOTP seed (encrypted at rest), pending until
        the user proves their authenticator works via mfa_enroll_verify(). It
        replaces any earlier authenticator kept from a time MFA was turned off.
        To switch back on with that earlier one instead, skip this and send a code
        from it straight to mfa_enroll_verify()."""
        user = self.current_user
        if user.mfa_enabled:
            raise BadRequestError("MFA is already enabled. Disable it first to re-enroll.")
        secret = pyotp.random_base32()
        with self.transaction():
            user.mfa_secret = encrypt_str(secret)
            user.mfa_last_used_step = None
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.username, issuer_name=settings.APP_NAME)
        return {"secret": secret, "otpauth_uri": uri}

    def mfa_enroll_verify(self, code: str) -> dict:
        user = self.db.query(User).filter(User.id == self.current_user.id).with_for_update().one()
        if user.mfa_enabled:
            raise BadRequestError("MFA is already enabled.")
        if not user.mfa_secret:
            raise BadRequestError("No enrollment in progress. Start enrollment first.")
        totp_step = self._matching_totp_step(user, code)
        if totp_step is None:
            raise BadRequestError("Invalid authentication code. Check your authenticator app.")
        raw_codes, hashes = _generate_backup_codes()
        with self.transaction():
            user.mfa_enabled = True
            user.mfa_epoch = (user.mfa_epoch or 0) + 1
            user.mfa_last_used_step = totp_step
            user.mfa_backup_codes = hashes
            # Tokens issued before MFA enrollment carry no MFA assurance. Kill
            # every old session so the next login must complete the second factor.
            self.db.query(AuthSession).filter(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(user, "auth.mfa_enabled")
        # Backup codes are shown exactly once here.
        return {"message": "MFA enabled", "backup_codes": raw_codes}

    def regenerate_backup_codes(self, code: str) -> dict:
        """Issue a fresh set of backup codes (invalidating the old ones).
        Requires a current TOTP code to authorize."""
        user = self.db.query(User).filter(User.id == self.current_user.id).with_for_update().one()
        if not user.mfa_enabled:
            raise BadRequestError("MFA is not enabled.")
        totp_step = self._matching_totp_step(user, code)
        if totp_step is None:
            raise BadRequestError("Invalid authentication code.")
        raw_codes, hashes = _generate_backup_codes()
        with self.transaction():
            user.mfa_backup_codes = hashes
            user.mfa_last_used_step = totp_step
            self._log_security_event(user, "auth.mfa_backup_regenerated")
        return {"backup_codes": raw_codes}

    def confirm_identity(self, password: str | None, code: str | None, *, reason: str) -> None:
        """Re-check the signed-in person before a sensitive act, such as making
        someone a Boss or an Admin: their own password, and a current authenticator
        code when they have two-factor on.

        A wrong password or code counts toward the same progressive lockout as a
        bad login, so a session left open can't be used to guess either one. The
        authenticator step is recorded, so one code can't confirm twice. This does
        not commit: the step goes in with the caller's transaction."""
        user = self.db.query(User).filter(User.id == self.current_user.id).with_for_update().one()
        lock = login_lockout(user.username)
        if lock.locked:
            raise _lockout_error(lock)
        # code="confirm_failed" lets the page ask again, in its popup.
        if not password:
            raise BadRequestError("Enter your password to confirm.", code="confirm_failed")
        needs_code = bool(user.mfa_enabled)
        if needs_code and not (code or "").strip():
            raise BadRequestError("Enter the code from your authenticator app to confirm.", code="confirm_failed")
        password_ok = verify_password(password, password_hash_for(user))
        totp_step = self._matching_totp_step(user, code or "") if needs_code else None
        if not password_ok or (needs_code and totp_step is None):
            state = register_login_failure(user.username)
            with self.transaction():
                self._log_security_event(
                    user,
                    "auth.confirm_failed",
                    f"{reason}: " + ("wrong password." if not password_ok else "invalid code."),
                )
            if state.locked:
                raise _lockout_error(state)
            raise BadRequestError(
                "Your password is incorrect." if not password_ok else "Invalid authentication code.",
                code="confirm_failed",
            )
        clear_login_failures(user.username)
        if totp_step is not None:
            user.mfa_last_used_step = totp_step

    def mfa_disable(self, code: str, password: str) -> dict:
        """Turn MFA off. It takes both the account password and a current
        authenticator code, and an account that must use MFA can't.

        A wrong password or code counts toward the same progressive lockout as a
        bad login, so a stolen session can't be used to guess either one.

        The authenticator is kept (and the step of the code that just authorised
        this, so that code can't switch it straight back on): the user may switch
        MFA back on with it, or set up a new one. Backup codes are not kept; turning
        MFA on issues a fresh set. Every session and remembered device is dropped."""
        user = self.db.query(User).filter(User.id == self.current_user.id).with_for_update().one()
        if not user.mfa_enabled:
            raise BadRequestError("MFA is not enabled.")
        if mfa_is_mandatory(user):
            raise BadRequestError("Two-factor authentication is required for your role, so it can't be turned off.")
        lock = login_lockout(user.username)
        if lock.locked:
            raise _lockout_error(lock)
        password_ok = verify_password(password, password_hash_for(user))
        totp_step = self._matching_totp_step(user, code)
        if not password_ok or totp_step is None:
            state = register_login_failure(user.username)
            with self.transaction():
                self._log_security_event(
                    user, "auth.mfa_disable_failed", "Wrong password." if not password_ok else "Invalid code."
                )
            if state.locked:
                raise _lockout_error(state)
            raise BadRequestError(
                "Current password is incorrect." if not password_ok else "Invalid authentication code."
            )
        clear_login_failures(user.username)
        with self.transaction():
            user.mfa_enabled = False
            user.mfa_epoch = (user.mfa_epoch or 0) + 1
            user.mfa_last_used_step = totp_step
            user.mfa_backup_codes = None
            self.db.query(AuthSession).filter(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
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
        session = self.db.query(AuthSession).filter(AuthSession.id == jti).with_for_update().first() if jti else None
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
        if payload.get("sub") != str(user.id) or payload.get("sid") != str(session.family_id):
            raise UnauthorizedError("Invalid refresh token")
        if refusal := sign_in_refusal(user, now=now_utc()):
            raise PermissionDeniedError(refusal)
        with self.transaction():
            session.revoked_at = now_utc()
            tokens = self._issue_tokens(
                user,
                family_id=session.family_id,
                family_expires_at=session.expires_at,
            )
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
        decoded: list[dict] = []
        for raw in (raw_access, raw_refresh):
            if not raw:
                continue
            try:
                payload = decode_token(raw)
            except Exception:
                continue  # expired/garbled — nothing to revoke from this one
            decoded.append(payload)
            if payload.get("type") == "access":
                blocklist_access_token(payload)  # Redis, DB-independent

        for payload in decoded:
            if payload.get("type") == "access" and payload.get("sid"):
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

    # ── active sessions / devices ─────────────────────────────────────────────

    def list_sessions(self, current_sid: str | None) -> list[dict]:
        """The user's live login sessions (one per device/family). Rotation keeps
        exactly one non-revoked row per family, so this lists active devices."""
        rows = (
            self.db.query(AuthSession)
            .filter(
                AuthSession.user_id == self.current_user.id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > now_utc(),
            )
            .order_by(AuthSession.created_at.desc())
            .all()
        )
        # Each family's first row is the sign-in itself; the live row is the
        # latest refresh, so it says where the device was last used.
        firsts: dict[uuid.UUID, AuthSession] = {}
        if rows:
            chain = (
                self.db.query(AuthSession)
                .filter(AuthSession.family_id.in_({r.family_id for r in rows}))
                .order_by(AuthSession.created_at.asc())
                .all()
            )
            for r in chain:
                firsts.setdefault(r.family_id, r)
        sessions: list[dict] = []
        for r in rows:
            first = firsts.get(r.family_id, r)
            desktop = "Electron" in (r.user_agent or "") or r.client == "Desktop app"
            sessions.append(
                {
                    "id": str(r.family_id),
                    "client": r.client or "Unknown device",
                    **describe_device(r.user_agent),
                    "user_agent": r.user_agent,
                    "ip_address": r.ip_address,
                    "signed_in_ip": first.ip_address,
                    "signed_in_at": first.created_at.isoformat(),
                    "last_active": r.created_at.isoformat(),
                    "expires_at": r.expires_at.isoformat(),
                    "current": current_sid is not None and str(r.family_id) == current_sid,
                    # The desktop app holds its tokens itself, not in browser cookies.
                    "cookies": [] if desktop else describe_session_cookies(r.expires_at),
                }
            )
        return sessions

    def revoke_session(self, family_id: uuid.UUID) -> dict:
        """Revoke one of the user's own sessions (e.g. a lost device). Another
        user's session id reads as not-found, never as forbidden."""
        owned = (
            self.db.query(AuthSession)
            .filter(AuthSession.family_id == family_id, AuthSession.user_id == self.current_user.id)
            .first()
        )
        if owned is None:
            raise NotFoundError("Session not found")
        with self.transaction():
            self._revoke_family(family_id)
            self._log_security_event(self.current_user, "auth.session_revoked")
        return {"message": "Session revoked"}

    def revoke_other_sessions(self, current_sid: str | None) -> dict:
        """Sign out every other device, keeping the current session alive."""
        q = self.db.query(AuthSession).filter(
            AuthSession.user_id == self.current_user.id,
            AuthSession.revoked_at.is_(None),
        )
        if current_sid:
            q = q.filter(AuthSession.family_id != uuid.UUID(current_sid))
        with self.transaction():
            count = q.update({AuthSession.revoked_at: now_utc()}, synchronize_session=False)
            self._log_security_event(self.current_user, "auth.sessions_revoked_others", f"{count} session(s)")
        return {"message": "Signed out other devices", "revoked": int(count)}

    # ── signup ────────────────────────────────────────────────────────────────

    @staticmethod
    def _request_tenant_provisioning(company: Company) -> None:
        provisioning.request(company, now=now_utc())

    @staticmethod
    def _require_agreement_acceptance(data) -> None:
        """Refuse to create an account without recorded consent.

        Checked server-side because a click-through only binds if we can show
        what was on screen and that it had to be ticked; a client-only check
        would let a scripted signup produce an account with no acceptance row.
        The version is compared too, so a stale tab cannot accept superseded
        terms.
        """
        if not getattr(data, "accepted_terms", False):
            raise BadRequestError("You must accept the Terms of Service and Privacy Policy to create an account.")
        sent = getattr(data, "agreement_version", None)
        if sent and sent != legal_docs.AGREEMENT_VERSION:
            raise ConflictError(
                "The terms were updated while you were signing up. Reload the page and review them again."
            )

    def signup(self, data, request=None) -> TokenResponse:
        self._validate_signup_invite(data.invite_code)
        turnstile.verify(
            data.turnstile_token,
            action=turnstile.SIGNUP_ACTION,
            remote_ip=client_ip(request) if request is not None else None,
        )
        self._require_agreement_acceptance(data)
        validate_password_strength(data.password)
        normalized_email = str(data.email).strip().lower()
        # One generic message for a username OR email clash, so signup can't be
        # used to confirm whether a given email/username is already registered.
        clash = self.db.query(User).filter((User.username == data.username) | (User.email == normalized_email)).first()
        if clash:
            raise ConflictError("An account with those details already exists.")
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
                email=normalized_email,
                full_name=data.full_name,
                password_hash=hash_password(data.password),
                role_id=owner_role.id,
            )
            self.db.add(user)
            self.db.flush()
            # Production provisions the expensive tenant schema only after the
            # email is proven. Without verification (the preview, or development),
            # production-mode deploys queue it for the provisioner, the only process
            # whose role may run DDL; development provisions inline with its own role.
            if not settings.REQUIRE_EMAIL_VERIFICATION:
                if settings.is_prod:
                    self._request_tenant_provisioning(company)
                else:
                    provision_tenant(company, db=self.db)
            LegalService(self.db).record_acceptance(
                user_id=user.id,
                company_id=company.id,
                request=request,
                method="signup",
            )
            self._issue_email_verification(user)
            tokens = self._issue_tokens(user)
        return tokens

    # ── email verification ────────────────────────────────────────────────────

    def _issue_email_verification(self, user: User) -> str | None:
        """Mint + store (hashed) a verification token and 'send' the link. Returns
        the raw token only in dev (EXPOSE_RESET_TOKEN) for testing. No commit."""
        if not user.email:
            return None
        raw = secrets.token_urlsafe(32)
        user.email_verification_hash = _sha256(raw)
        user.email_verification_expires = now_utc() + timedelta(hours=settings.EMAIL_VERIFICATION_TOKEN_HOURS)
        # URL fragments are not sent in HTTP requests, access logs, or Referer.
        link = f"{settings.FRONTEND_BASE_URL}/verify-email#token={raw}"
        send_account_email(
            to=user.email,
            subject=f"Verify your {settings.APP_NAME} email",
            text=f"Verify your email address using this one-time link:\n\n{link}\n",
        )
        logger.info("Email verification issued for user=%s (token redacted)", user.username)
        return raw if settings.EXPOSE_RESET_TOKEN else None

    def verify_email(self, token: str) -> dict:
        """Consume a verification token (unauthenticated — the user clicks a link)."""
        user = (
            self.db.query(User).filter(User.email_verification_hash == _sha256(token.strip())).with_for_update().first()
        )
        if user is None or user.email_verification_expires is None or user.email_verification_expires <= now_utc():
            raise BadRequestError("This verification link is invalid or has expired.")
        with self.transaction():
            user.email_verified = True
            user.email_verification_hash = None
            user.email_verification_expires = None
            if user.company is not None and user.company.provisioned_at is None:
                if settings.is_prod:
                    self._request_tenant_provisioning(user.company)
                else:
                    provision_tenant(user.company, db=self.db)
            self._log_security_event(user, "auth.email_verified")
        message = "Email verified. Thank you."
        if user.company is not None and user.company.provisioned_at is None:
            message = "Email verified. Account setup is now in progress."
        return {"message": message}

    def resend_verification(self) -> dict:
        """Re-issue a verification link for the signed-in user's email."""
        user = self.current_user
        if user.email_verified or not user.email:
            return {"message": "Email already verified." if user.email_verified else "No email on file."}
        with self.transaction():
            raw = self._issue_email_verification(user)
        resp = {"message": "Verification email sent."}
        if raw is not None:
            resp["verification_token"] = raw  # dev only
        return resp

    # ── Google OAuth ──────────────────────────────────────────────────────────

    @staticmethod
    def _verified_google_identity(credential: str) -> tuple[str, str, str, str]:
        if id_token is None or google_requests is None or not settings.GOOGLE_CLIENT_ID:
            raise NotConfiguredError("Google authentication is not configured on the server")
        try:
            id_info = id_token.verify_oauth2_token(credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID)
        except Exception:
            logger.warning("Google token verification failed", exc_info=True)
            raise BadRequestError("Invalid Google credential")

        email = str(id_info.get("email") or "").strip().lower()
        full_name = str(id_info.get("name") or "").strip()
        subject = str(id_info.get("sub") or "").strip()
        issuer = str(id_info.get("iss") or "").strip()
        if (
            not email
            or not full_name
            or not subject
            or id_info.get("email_verified") is not True
            or issuer not in {"accounts.google.com", "https://accounts.google.com"}
        ):
            raise BadRequestError("Google account does not provide a verified identity")
        return email, full_name, subject, issuer

    def _authorize_sensitive_identity_change(self, user: User, data) -> int | None:
        """Require a fresh password or unused TOTP before changing login methods."""
        if user.mfa_enabled:
            step = self._matching_totp_step(user, data.mfa_code) if data.mfa_code else None
            if step is None:
                raise PermissionDeniedError("A current MFA code is required.")
            return step
        if not data.current_password or not verify_password(data.current_password, password_hash_for(user)):
            raise PermissionDeniedError("Your current password is required.")
        return None

    def link_google_identity(self, data) -> dict:
        email, _name, subject, issuer = self._verified_google_identity(data.credential)
        user = self.db.query(User).filter(User.id == self.current_user.id).with_for_update().one()
        if is_cloudflare_admin(user):
            # Google would be a way in that goes around the Cloudflare password.
            raise BadRequestError("This account signs in only with its password from Cloudflare.")
        step = self._authorize_sensitive_identity_change(user, data)
        if not user.email_verified or (user.email or "").strip().lower() != email:
            raise PermissionDeniedError("Google must use the same verified email as this account.")
        owner = self.db.query(User).filter(User.google_sub == subject, User.id != user.id).first()
        if owner is not None:
            raise ConflictError("That Google identity is already linked to another account.")
        with self.transaction():
            user.google_issuer = issuer
            user.google_sub = subject
            if step is not None:
                user.mfa_last_used_step = step
            self.db.query(AuthSession).filter(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(user, "auth.google_linked", "All sessions revoked after login-method change.")
        return {"message": "Google account linked. Please sign in again."}

    def unlink_google_identity(self, data) -> dict:
        user = self.db.query(User).filter(User.id == self.current_user.id).with_for_update().one()
        if not user.google_sub:
            return {"message": "No Google account is linked."}
        step = self._authorize_sensitive_identity_change(user, data)
        with self.transaction():
            user.google_issuer = None
            user.google_sub = None
            if step is not None:
                user.mfa_last_used_step = step
            self.db.query(AuthSession).filter(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(user, "auth.google_unlinked", "All sessions revoked after login-method change.")
        return {"message": "Google account unlinked. Please sign in again."}

    def google_auth(
        self, data, mfa_trust_tokens: Sequence[str] = (), request=None
    ) -> TokenResponse | MfaChallengeResponse:
        email, full_name, subject, issuer = self._verified_google_identity(data.credential)

        user = self.db.query(User).filter(User.google_sub == subject).first()

        if user:
            if user.google_issuer != issuer or (user.email or "").lower() != email:
                raise PermissionDeniedError(
                    "Google identity details changed; sign in with your existing method and relink the account."
                )
            if not user.is_active:
                raise PermissionDeniedError("Account disabled")
            if refusal := sign_in_refusal(user, now=now_utc()):
                raise PermissionDeniedError(refusal)
            if user.company is not None and user.company.provisioned_at is None:
                if settings.is_prod:
                    with self.transaction():
                        self._request_tenant_provisioning(user.company)
                    raise ServiceUnavailableError("Account setup is in progress. Please try again shortly.")
                provision_tenant(user.company, db=self.db)
            # A verified Google identity proves the first factor only — an
            # MFA-enabled account must still pass the TOTP challenge, unless this
            # device is within its MFA trust window.
            if user.mfa_enabled and not self._mfa_trusted(user, mfa_trust_tokens):
                return MfaChallengeResponse(challenge_token=self._mfa_challenge_token(user))
            clear_login_failures(user.username)
            with self.transaction():
                user.last_login = datetime.now(timezone.utc)
                tokens = self._issue_tokens(user)
                self._log_security_event(user, "auth.google_login")
            return tokens
        else:
            self._validate_signup_invite(data.invite_code)
            if self.db.query(User).filter(User.email == email).first():
                raise ConflictError(
                    "An account already uses this email. Sign in with its existing method before linking Google."
                )
            if not data.company_name:
                raise BadRequestError("Company name is required for new accounts via Google")
            self._require_agreement_acceptance(data)
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
                base_username = re.sub(r"[^A-Za-z0-9_.-]", "", email.split("@")[0])[:40] or "user"
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
                    email_verified=True,
                    google_issuer=issuer,
                    google_sub=subject,
                )
                self.db.add(user)
                self.db.flush()
                LegalService(self.db).record_acceptance(
                    user_id=user.id,
                    company_id=company.id,
                    request=request,
                    method="signup_google",
                )
                # Production queues DDL for the isolated provisioner. Local/test
                # environments can provision in-transaction with their dev role.
                if settings.is_prod:
                    self._request_tenant_provisioning(company)
                    tokens = None
                else:
                    provision_tenant(company, db=self.db)
                    tokens = self._issue_tokens(user)
            if tokens is None:
                raise ServiceUnavailableError("Account created. Setup is in progress; please try again shortly.")
            assert tokens is not None
            return tokens

    # ── account self-service ──────────────────────────────────────────────────

    def me(self) -> dict:
        user = self.current_user
        sub = None
        # The platform owner is the other party to the agreements, not a
        # customer bound by them, and belongs to no tenant.
        legal_required = False
        unread = 0
        if user.company_id and not user.is_platform_admin:
            sub, legal_required, counted = self._account_state(user)
            if sub is None:
                # No subscription row yet: start one on Free. Commit only then.
                # /me is polled every minute, and a needless commit hands the
                # connection back and expires every loaded row, so the rest of
                # this method would reload the user, company and role again.
                sub = ensure_subscription(self.db, user.company_id)
                if sub is not None:
                    self.db.commit()
            else:
                # Commits by itself, and only when a paid plan has run out.
                sub = downgrade_if_expired(self.db, sub)
            unread = counted if counted is not None else self._notifications_unread(user)

        features = get_user_features(user, self.db)

        plan_info = None
        if sub is not None and sub.plan:
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
            # A role the mill's Boss made up has no built-in name; this is what to call it.
            "role_label": user.custom_role.name if user.custom_role else None,
            "company_id": str(user.company_id) if user.company_id else None,
            "branch_id": str(user.branch_id) if user.branch_id else None,
            # Where the branch picker opens: "main", "all", or a branch id.
            "branch_view_default": user.default_branch_view or "main",
            "is_platform_admin": user.is_platform_admin,
            "subscription": plan_info,
            "features": features,
            # Open, or closed by the Boss (paused, or deletion asked for): the web
            # app shows the closed-account screen for anything but open.
            "account": describe_account(user.company),
            "tenant_provisioned": bool(user.company is None or user.company.provisioned_at is not None),
            "tenant_provisioning_pending": bool(
                user.company is not None
                and user.company.provisioned_at is None
                and user.company.provisioning_requested_at is not None
            ),
            "email_verified": user.email_verified,
            "email_verification_required": (
                settings.REQUIRE_EMAIL_VERIFICATION and bool(user.email) and not user.email_verified
            ),
            # On a temporary password: the app asks for a new one before anything else.
            "password_change_required": password_change_pending(user),
            "mfa_enabled": user.mfa_enabled,
            # This account must use MFA: no turning it off.
            "mfa_required": mfa_is_mandatory(user),
            # MFA is off, and the authenticator it was turned off with is still on
            # file: it can be switched back on with a fresh code from it.
            "mfa_previous_authenticator": has_previous_mfa_secret(user),
            "google_linked": bool(user.google_sub),
            "mfa_backup_codes_remaining": len(user.mfa_backup_codes or []) if user.mfa_enabled else 0,
            # High-privilege accounts (platform admin / owner) should enroll in
            # MFA — the UI uses this to prompt until they do.
            "mfa_setup_recommended": bool(is_privileged and not user.mfa_enabled),
            # Hard gate: when true, enforcement is on and the API blocks data
            # endpoints until this user enrolls. The web app shows a mandatory
            # enrollment screen.
            "mfa_enrollment_required": mfa_enrollment_pending(user),
            # Soft gate: the web app shows a mandatory re-acceptance screen when
            # the published agreement bundle is newer than what this user
            # accepted (or when there is no acceptance at all).
            # The platform owner is the other party to these agreements, not a
            # customer bound by them, so the admin console is never gated.
            "legal_acceptance_required": legal_required,
            "agreement_version": legal_docs.AGREEMENT_VERSION,
            # The bell's badge. /auth/me is already polled every 10s, so the
            # count rides along instead of adding a second poller.
            "notifications_unread": unread,
        }

    def _account_state(self, user: User) -> tuple[Subscription | None, bool, int | None]:
        """What /auth/me reports beyond the user row, in one database round trip:
        the subscription with its plan, whether the terms must be accepted again,
        and (once this schema is known to have the table) the unread count.

        Runs only after get_current_user has matched the token to this user, their
        active company and its schema. Every part is filtered on this user's or
        this company's own id, and the unread count reads the schema the request
        is already scoped to, so nothing from another account can come back.
        Returns the unread count as None when it wasn't counted here.
        """
        company = user.company
        count_unread = (
            company is not None
            and company.provisioned_at is not None
            and company.schema_name in _SCHEMAS_WITH_NOTIFICATIONS
        )
        columns: list[Any] = [Subscription, LegalService.acceptance_current_column(user.id)]
        if count_unread:
            columns.append(unread_count_column(user.id))
        row = self.db.execute(
            select(*columns)
            .select_from(User)
            .outerjoin(Subscription, Subscription.company_id == User.company_id)
            .options(joinedload(Subscription.plan))
            .where(User.id == user.id)
        ).one()
        unread = int(row[2] or 0) if count_unread else None
        return row[0], not row[1], unread

    def _notifications_unread(self, user: User) -> int:
        # Only a provisioned tenant has a schema with a notifications table;
        # platform admins belong to no tenant.
        if user.is_platform_admin or user.company is None or user.company.provisioned_at is None:
            return 0
        from sqlalchemy.exc import ProgrammingError

        from .notification_service import unread_count

        try:
            # A savepoint: a tenant schema not migrated yet (no notifications
            # table) must not fail /auth/me, which every page depends on.
            with self.db.begin_nested():
                count = unread_count(self.db, user.id)
            # The table is there: from now on the count rides along in the
            # account query instead of costing a savepoint each time.
            if user.company is not None and user.company.schema_name:
                _SCHEMAS_WITH_NOTIFICATIONS.add(user.company.schema_name)
            return count
        except ProgrammingError:
            logger.warning("notifications table missing for company %s", user.company_id)
            return 0

    # ── password reset ────────────────────────────────────────────────────────

    def request_password_reset(self, identifier: str) -> dict:
        """Issue a reset token for the account matching ``identifier`` (username
        or email). Enumeration-safe: the response is identical whether or not an
        account matched, so it can't be used to probe which emails are registered.

        With no email provider wired up, the reset link is logged server-side;
        in dev (EXPOSE_RESET_TOKEN) the raw token is also returned for testing.
        """
        ident = identifier.strip()
        user = self.db.query(User).filter((User.username == ident) | (User.email == ident)).first()
        exposed_token: str | None = None
        # The Cloudflare admin's password is a Worker secret: there's nothing to reset.
        if user is not None and not is_cloudflare_admin(user):
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
            link = f"{settings.FRONTEND_BASE_URL}/reset-password#token={raw}"
            if user.email:
                send_account_email(
                    to=user.email,
                    subject=f"Reset your {settings.APP_NAME} password",
                    text=(
                        "A password reset was requested for your account. "
                        f"Use this one-time link:\n\n{link}\n\n"
                        "If you did not request this, ignore this email."
                    ),
                )
            # Logs the username only; the raw token never reaches the message.
            # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
            logger.info("Password reset issued for user=%s (token redacted)", user.username)
            if settings.EXPOSE_RESET_TOKEN:
                exposed_token = raw
        resp = {"message": "If an account matches, a reset link has been sent."}
        if exposed_token is not None:
            resp["reset_token"] = exposed_token  # dev only
        return resp

    def reset_password(self, token: str, new_password: str) -> dict:
        """Consume a reset token and set a new password. Revokes all sessions."""
        validate_password_strength(new_password)
        row = (
            self.db.query(PasswordResetToken)
            .filter(PasswordResetToken.token_hash == _sha256(token.strip()))
            .with_for_update()
            .first()
        )
        if row is None or row.used_at is not None or row.expires_at <= now_utc():
            raise BadRequestError("This reset link is invalid or has expired.")
        user = self.db.get(User, row.user_id)
        if user is None or is_cloudflare_admin(user):
            raise BadRequestError("This reset link is invalid or has expired.")
        with self.transaction():
            user.password_hash = hash_password(new_password)
            user.must_change_password = False
            user.temp_password_expires_at = None
            row.used_at = now_utc()
            # A reset is a credential change — kill every existing session.
            self.db.query(AuthSession).filter(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(user, "auth.password_reset", "All sessions revoked.")
        # A successful reset is the way out of a (possibly permanent) lockout —
        # clear the failure tally, the active lock, and the escalation memory.
        clear_login_failures(user.username)
        return {"message": "Password has been reset. Please log in."}

    def issue_temporary_password(self, target: User, issued_by: User) -> dict:
        """Replace ``target``'s password with a temporary one, for someone locked out.

        Callers decide who may do this (a Boss for their own staff, the platform
        admin for anyone). This unlocks the account, signs the person out everywhere,
        and makes them choose their own password at first sign-in; the temporary one
        also expires. The password is returned once, to be handed over directly: it
        is never emailed, and never stored in the clear."""
        if is_cloudflare_admin(target):
            raise BadRequestError("This account's password is set in Cloudflare (PLATFORM_ADMIN_PASSWORD_HASH).")
        password = generate_temporary_password()
        expires = now_utc() + timedelta(hours=settings.TEMP_PASSWORD_HOURS)
        who = issued_by.full_name or issued_by.username
        with self.transaction():
            target.password_hash = hash_password(password)
            target.must_change_password = True
            target.temp_password_expires_at = expires
            self.db.query(AuthSession).filter(
                AuthSession.user_id == target.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(
                target, "auth.temporary_password_issued", f"Issued by {who}. All sessions revoked."
            )
        # Locked out, so the lockout is what a temporary password is for.
        clear_login_failures(target.username)
        platform_emails.temporary_password_issued(target, by=who)
        return {
            "username": target.username,
            "temporary_password": password,
            "expires_at": expires.isoformat(),
        }

    def request_lockout_help(self, username: str, message: str | None) -> dict:
        """A locked-out Boss asks the platform admin for a temporary password.

        Public, so it answers the same whatever matched: the admin is only emailed
        when the username is a real, active Boss account that is locked right now,
        and at most once an hour per account. Employees go to their Boss instead."""
        answer = {"message": "If that is a locked Boss account, the admin has been told and will contact you."}
        user = self.db.query(User).filter(User.username == username.strip()).first()
        if user is None or user.is_platform_admin or not user.is_active:
            return answer
        if not (user.role and user.role.name == "owner"):
            return answer
        state = login_lockout(user.username)
        if not state.locked or not first_lockout_help_request(user.username):
            return answer
        company = user.company.name if user.company is not None else ""
        note = " ".join((message or "").split())[:300]
        platform_emails.lockout_help_requested(self.db, user, state, company=company, message=note)
        with self.transaction():
            self._log_security_event(user, "auth.lockout_help_requested")
        return answer

    def change_password(self, data) -> dict:
        if is_cloudflare_admin(self.current_user):
            raise BadRequestError("This account's password is set in Cloudflare (PLATFORM_ADMIN_PASSWORD_HASH).")
        if not verify_password(data.current_password, self.current_user.password_hash):
            raise BadRequestError("Current password is incorrect")
        validate_password_strength(data.new_password)
        if self.current_user.must_change_password and data.new_password == data.current_password:
            raise BadRequestError("Choose a password different from the temporary one.")
        with self.transaction():
            self.current_user.password_hash = hash_password(data.new_password)
            self.current_user.must_change_password = False
            self.current_user.temp_password_expires_at = None
            # Kill every refresh session for this user: a password change must
            # invalidate any token a previous holder (or thief) still has.
            self.db.query(AuthSession).filter(
                AuthSession.user_id == self.current_user.id,
                AuthSession.revoked_at.is_(None),
            ).update({AuthSession.revoked_at: now_utc()})
            self._log_security_event(self.current_user, "auth.password_changed", "All sessions revoked.")
        return {"message": "Password changed successfully"}

    def update_profile(self, data) -> dict:
        email_changed = (
            data.email is not None
            and str(data.email).strip().lower() != (self.current_user.email or "").strip().lower()
        )
        user = self.current_user
        accepted_totp_step: int | None = None
        if email_changed:
            user = self.db.query(User).filter(User.id == self.current_user.id).with_for_update().one()
            if user.mfa_enabled:
                accepted_totp_step = self._matching_totp_step(user, data.mfa_code) if data.mfa_code else None
                if accepted_totp_step is None:
                    raise PermissionDeniedError("A current MFA code is required to change your email address.")
            elif not data.current_password or not verify_password(data.current_password, password_hash_for(user)):
                raise PermissionDeniedError("Your current password is required to change your email address.")

        with self.transaction():
            if data.full_name is not None:
                user.full_name = data.full_name.strip()
            if email_changed:
                normalized_email = str(data.email).strip().lower()
                clash = self.db.query(User).filter(User.email == normalized_email, User.id != user.id).first()
                if clash:
                    raise ConflictError("Email already in use")
                user.email = normalized_email
                user.email_verified = False
                user.email_verification_hash = None
                user.email_verification_expires = None
                if accepted_totp_step is not None:
                    user.mfa_last_used_step = accepted_totp_step
                self._issue_email_verification(user)
                # Changing the recovery address is a security-boundary change.
                self.db.query(AuthSession).filter(
                    AuthSession.user_id == user.id,
                    AuthSession.revoked_at.is_(None),
                ).update({AuthSession.revoked_at: now_utc()})
                self._log_security_event(
                    user,
                    "auth.email_changed",
                    "Email changed; verification required; sessions revoked.",
                )
        return {
            "message": "Profile updated",
            "email_verification_required": bool(email_changed),
        }
