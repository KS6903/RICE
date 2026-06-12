import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
import bcrypt as _bcrypt
import jwt
from jwt import InvalidTokenError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import settings
from .cookies import ACCESS_COOKIE
from .csrf import enforce_csrf
from .database import get_db
from .cache import cache, TTL_FEATURES

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


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False  # malformed stored hash — treat as non-match, never crash auth


def create_access_token(data: dict[str, Any], jti: str | None = None) -> str:
    """Issue an access token. Every token carries a ``jti`` so it can be
    individually blocklisted on logout/password change (best-effort via Redis)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {**data, "exp": expire, "type": "access", "jti": jti or uuid.uuid4().hex}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict[str, Any], jti: str) -> str:
    """Issue a refresh token. ``jti`` is REQUIRED and must be the id of an
    ``AuthSession`` row — refresh tokens are stateful so they can be rotated and
    revoked (see services/auth_service.py)."""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {**data, "exp": expire, "type": "refresh", "jti": jti}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
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
    return bool(jti) and cache.exists(_blocklist_key(jti))


def get_access_token_payload(token: str = Depends(get_token)) -> dict[str, Any]:
    """Decoded access-token claims (for routes that need jti/sid, e.g. logout)."""
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    return payload


def get_current_user(token: str = Depends(get_token), db: Session = Depends(get_db)):
    from ..models.user import User
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    if is_access_token_blocklisted(payload):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")
    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def mfa_required_for(user) -> bool:
    """True if this account's role obliges it to use MFA (platform admins always)."""
    if getattr(user, "is_platform_admin", False):
        return True
    role = getattr(user, "role", None)
    return bool(role and role.name in settings.mfa_required_role_names)


def mfa_enrollment_pending(user) -> bool:
    """True when enforcement is on, this account must use MFA, and it hasn't enrolled."""
    return settings.MFA_ENFORCE and mfa_required_for(user) and not getattr(user, "mfa_enabled", False)


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


def require_roles(*roles: str):
    def checker(current_user=Depends(get_current_user)):
        if current_user.role and current_user.role.name not in roles:
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
    from ..services.subscription import effective_status, ACTIVE_STATUSES
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
