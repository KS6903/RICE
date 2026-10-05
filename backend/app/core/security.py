import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt as _bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from .cache import TTL_FEATURES, cache
from .config import settings
from .cookies import ACCESS_COOKIE
from .csrf import enforce_csrf
from .database import get_db

# Server-side mirror of ``packages/shared/src/constants/access.ts``.  The UI
# matrix is an ergonomics layer; this policy is the actual authorization
# boundary.  Keep it explicit and fail-closed so a newly introduced/typoed role
# never inherits access accidentally.
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
    },
}

APP_SECTIONS = frozenset(next(iter(SECTION_ACCESS.values())))

# auto_error=False: a missing Authorization header falls through to the session
# cookie (web client) inside get_token, instead of an immediate 401.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_token(request: Request, header_token: str | None = Depends(oauth2_scheme)) -> str:
    """Resolve the access token: Authorization header first, session cookie second.

    The Bearer header serves the Electron desktop app, tests, and API scripts —
    those clients are CSRF-immune (a cross-site page can't set that header). When
    auth comes from the httpOnly cookie (the web SPA), mutating requests must
    pass the CSRF double-submit check.
    """
    if header_token:
        return header_token
    cookie_token = request.cookies.get(ACCESS_COOKIE)
    if cookie_token:
        enforce_csrf(request)
        return cookie_token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


# Direct bcrypt (passlib was unmaintained). Hashes remain standard $2b$ —
# everything passlib produced before this swap still verifies unchanged.
def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt(rounds=12)).decode("ascii")


# bcrypt reads at most 72 bytes. bcrypt 4 silently dropped the rest; bcrypt 5
# raises instead. New passwords are capped at 72 bytes (passwords.py), but a
# hash made from a longer one under bcrypt 4 must still verify, so a login
# compares what bcrypt always compared: the first 72 bytes.
BCRYPT_MAX_BYTES = 72


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8")[:BCRYPT_MAX_BYTES], hashed.encode("ascii"))
    except ValueError:
        return False  # malformed stored hash — treat as non-match, never crash auth


def create_access_token(data: dict[str, Any], jti: str | None = None) -> str:
    """Issue an access token. Every token carries a ``jti`` so it can be
    individually blocklisted on logout/password change (best-effort via Redis)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        **data,
        "iat": datetime.now(timezone.utc),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "exp": expire,
        "type": "access",
        "jti": jti or uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict[str, Any], jti: str) -> str:
    """Issue a refresh token. ``jti`` is REQUIRED and must be the id of an
    ``AuthSession`` row — refresh tokens are stateful so they can be rotated and
    revoked (see services/auth_service.py)."""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        **data,
        "iat": datetime.now(timezone.utc),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "exp": expire,
        "type": "refresh",
        "jti": jti,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            issuer=settings.JWT_ISSUER,
            audience=settings.JWT_AUDIENCE,
            options={"require": ["exp", "iat", "iss", "aud", "type", "jti"]},
        )
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


# ── Access-token blocklist (best-effort) ──────────────────────────────────────
# Refresh sessions are revoked durably in Postgres (auth_sessions); the blocklist
# below additionally kills *live access tokens* on logout/password change. It is
# Redis-backed and best-effort by design: when Redis is down the worst case is an
# access token staying valid for its remaining lifetime (≤ ACCESS_TOKEN_EXPIRE_MINUTES).


def _blocklist_key(jti: str) -> str:
    return f"token:block:{jti}"


def blocklist_access_token(payload: dict[str, Any]) -> None:
    """Blocklist a decoded access token for its remaining lifetime."""
    jti = payload.get("jti")
    if not jti:
        return
    ttl = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    exp = payload.get("exp")
    if exp:
        remaining = int(exp - datetime.now(timezone.utc).timestamp())
        ttl = max(min(remaining, ttl), 1)
    cache.set_int(_blocklist_key(jti), 1, ttl=ttl)


def is_access_token_blocklisted(payload: dict[str, Any]) -> bool:
    jti = payload.get("jti")
    return isinstance(jti, str) and bool(jti) and cache.exists(_blocklist_key(jti))


def get_access_token_payload(token: str = Depends(get_token)) -> dict[str, Any]:
    """Decoded access-token claims (for routes that need jti/sid, e.g. logout)."""
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    return payload


def authenticate_access_token(token: str, db: Session):
    """Validate an access token, its user/tenant binding, and durable session."""
    from ..models.auth_session import AuthSession
    from ..models.user import User
    from .tenancy import valid_schema_name

    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    if is_access_token_blocklisted(payload):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    # Fail-closed tenant isolation: a normal (tenant) user's token MUST carry a
    # valid client schema — get_db scopes the session's search_path to it, so a
    # missing/forged schema would otherwise leave the request on bare `public`.
    # Reject rather than serve. Platform admins legitimately carry no schema
    # (they operate on `public` and loop client schemas via tenant_session).
    if not payload.get("is_platform_admin") and not valid_schema_name(payload.get("schema")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    if not user.is_platform_admin:
        # A syntactically valid schema claim is not sufficient: it must be the
        # schema currently assigned to this active user's active company.  This
        # closes the gap where a forged token could point the DB search_path at a
        # different, but validly named, tenant schema.
        company = user.company
        if not company or not company.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Company not found or inactive")
        if payload.get("company_id") != str(company.id):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        if payload.get("schema") != company.schema_name:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    sid = payload.get("sid")
    try:
        family_id = uuid.UUID(str(sid))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    live_session = (
        db.query(AuthSession.id)
        .filter(
            AuthSession.family_id == family_id,
            AuthSession.user_id == user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > datetime.now(timezone.utc),
        )
        .first()
    )
    if live_session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been revoked")
    return user, payload


def get_current_user(
    request: Request,
    token: str = Depends(get_token),
    db: Session = Depends(get_db),
):
    user, _payload = authenticate_access_token(token, db)
    request.state.auth_context = {
        "user_id": user.id,
        "company_id": user.company_id,
        "username": user.username,
        "schema": user.company.schema_name if user.company is not None else None,
    }
    return user


def mfa_required_for(user) -> bool:
    """True if this account's role obliges it to use MFA (platform admins always)."""
    if getattr(user, "is_platform_admin", False):
        return True
    role = getattr(user, "role", None)
    return bool(role and role.name in settings.mfa_required_role_names)


def mfa_is_mandatory(user) -> bool:
    """True when enforcement is on and this account must use MFA: it can't be left
    off, and can't be turned off."""
    return settings.MFA_ENFORCE and mfa_required_for(user)


def mfa_enrollment_pending(user) -> bool:
    """True when this account must use MFA and hasn't enrolled."""
    return mfa_is_mandatory(user) and not getattr(user, "mfa_enabled", False)


def enforce_mfa_enrollment(current_user=Depends(get_current_user)):
    """Gate dependency for data routers: a privileged account that hasn't enrolled
    in MFA is blocked (403) from everything except the auth/* endpoints (so it can
    still call /me, log out, and enroll). The web app reads the same condition from
    /me (`mfa_enrollment_required`) and shows a mandatory enrollment screen."""
    if mfa_enrollment_pending(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Two-factor authentication setup is required for your role before continuing.",
        )
    return current_user


def password_change_pending(user) -> bool:
    """True while the user is on a temporary password and must choose their own."""
    return bool(getattr(user, "must_change_password", False))


def enforce_password_change(current_user=Depends(get_current_user)):
    """Gate dependency for data routers: someone signed in on a temporary password
    is blocked (403) from everything except the auth/* endpoints (so they can still
    call /me, change the password, and log out). The web app reads the same
    condition from /me (`password_change_required`) and shows a change screen."""
    if password_change_pending(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Choose a new password before continuing.",
        )
    return current_user


def enforce_email_verified(current_user=Depends(get_current_user)):
    """Gate dependency: when REQUIRE_EMAIL_VERIFICATION is on, a user with an
    unconfirmed email is blocked (403) from data endpoints until they verify.
    /auth stays open so they can verify and resend. Off by default."""
    if (
        settings.REQUIRE_EMAIL_VERIFICATION
        and getattr(current_user, "email", None)
        and not getattr(current_user, "email_verified", False)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email address to continue.",
        )
    return current_user


def enforce_tenant_provisioned(current_user=Depends(get_current_user)):
    """Keep data routes closed until the isolated DDL worker finishes setup."""
    company = getattr(current_user, "company", None)
    if company is not None and company.provisioned_at is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account setup is in progress. Please try again shortly.",
        )
    return current_user


def require_roles(*roles: str):
    allowed = frozenset(roles)

    def checker(current_user=Depends(get_current_user)):
        if getattr(current_user, "is_platform_admin", False):
            return current_user
        role = getattr(current_user, "role", None)
        role_name = getattr(role, "name", None)
        if role_name not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return checker


def require_section_access(section: str, *, write: bool = False):
    """Require the role-matrix access level for one tenant application section.

    Reads accept either ``view`` or ``full``.  Mutations require ``full``.
    Missing and unknown roles are denied.  Platform administrators retain their
    cross-tenant control-plane bypass and are still constrained by service-level
    tenant scoping where applicable.
    """
    if section not in APP_SECTIONS:
        raise ValueError(f"Unknown application section: {section}")

    def checker(current_user=Depends(get_current_user)):
        if getattr(current_user, "is_platform_admin", False):
            return current_user
        role = getattr(current_user, "role", None)
        role_name = getattr(role, "name", None)
        level = SECTION_ACCESS.get(role_name or "", {}).get(section, "none")
        allowed = level == "full" if write else level in {"view", "full"}
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return checker


def require_platform_admin(current_user=Depends(get_current_user)):
    if not current_user.is_platform_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform admin access required")
    return current_user


def features_cache_key(company_id) -> str:
    """Redis key for a company's plan entitlements."""
    return f"features:{company_id}"


def invalidate_company_features(company_id) -> None:
    """Drop the cached feature list for a company.

    Call this from any path that mutates a company's subscription/plan so the
    next request recomputes entitlements from the DB instead of serving stale
    cache. Safe no-op when Redis is unavailable."""
    if company_id is not None:
        cache.delete(features_cache_key(company_id))


def _compute_user_features(user, db: Session) -> list[str]:
    from ..models.subscription import Subscription
    from ..services.subscription import ACTIVE_STATUSES, effective_status

    sub = db.query(Subscription).filter(Subscription.company_id == user.company_id).first()
    if not sub or not sub.plan:
        return []
    if effective_status(sub) not in ACTIVE_STATUSES:
        return []
    return list(sub.plan.features or [])


def get_user_features(user, db: Session) -> list[str]:
    """Returns the list of feature codes available to this user via their company's subscription.

    Cache-aside: served from Redis when warm (keyed by company), recomputed from
    PostgreSQL on a miss. A short TTL bounds staleness even if an invalidation is
    ever missed; subscription mutations call invalidate_company_features() to drop
    the entry immediately."""
    if user.is_platform_admin:
        return ["*"]  # platform admin has everything
    if not user.company_id:
        return []
    key = features_cache_key(user.company_id)
    cached = cache.get_json(key)
    if cached is not None:
        return cached
    features = _compute_user_features(user, db)
    # Cache the result — including an empty list (negative caching) so expired or
    # plan-less companies don't re-hit the DB on every feature-gated request.
    cache.set_json(key, features, ttl=TTL_FEATURES)
    return features


def require_feature(feature: str):
    """FastAPI dependency that enforces the user's plan includes a given feature."""

    def checker(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
        if current_user.is_platform_admin:
            return current_user
        features = get_user_features(current_user, db)
        if feature not in features:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"This feature ('{feature}') is not included in your current plan. Please contact your platform administrator to upgrade.",
            )
        return current_user

    return checker
