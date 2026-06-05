from datetime import datetime, timedelta, timezone
from typing import Any
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .cache import cache, TTL_FEATURES

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict[str, Any]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({**data, "exp": expire, "type": "access"}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict[str, Any]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({**data, "exp": expire, "type": "refresh"}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from ..models.user import User
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


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
