"""The platform admin whose password lives in Cloudflare, not in the database.

PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD_HASH (a bcrypt hash, made with
``create_platform_admin.py --hash``) are Worker secrets. At startup the API makes
sure that username is an active platform admin. Its row never holds the password
hash: the column keeps a marker no password matches, and every password check for
this account compares against the secret instead. Sessions and two-factor still
need the row, so the row stays.

To change the password, change the secret and restart the API (a deploy does it).
The marker records which hash is current, so a new one signs the admin out of
every device. Inside the app the password can't be changed, reset or replaced,
and the account can't sign in with Google: Cloudflare is the only way in.
"""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.auth_session import AuthSession
from ..models.base import now_utc
from ..models.user import User
from .config import settings

logger = logging.getLogger("ricemill.platform_admin")

# Not a bcrypt hash, so verify_password never matches it.
MARKER_PREFIX = "cloudflare-secret:"
DEFAULT_FULL_NAME = "Platform Admin"


def managed_username() -> str | None:
    return settings.PLATFORM_ADMIN_USERNAME or None


def is_managed(user: User | None) -> bool:
    """True for the platform admin whose password is the Cloudflare secret."""
    name = managed_username()
    return bool(name) and user is not None and user.username == name and bool(user.is_platform_admin)


def password_hash_for(user: User) -> str:
    """The hash a sign-in or identity check compares the password against."""
    if is_managed(user) and settings.PLATFORM_ADMIN_PASSWORD_HASH is not None:
        return settings.PLATFORM_ADMIN_PASSWORD_HASH.get_secret_value()
    return user.password_hash


def marker(password_hash: str) -> str:
    """What the row keeps instead of the hash: it names the current secret, so a
    new one can be noticed, and no password matches it."""
    return MARKER_PREFIX + hashlib.sha256(password_hash.encode("ascii")).hexdigest()


def _email_is_free(db: Session, email: str, user: User | None) -> bool:
    other = db.query(User).filter(User.email == email).first()
    return other is None or other is user


def sync(db: Session, *, _retry: bool = True) -> str:
    """Make the configured username an active platform admin. Returns what it did:
    "not configured", "created", "updated", "unchanged" or "refused"."""
    name = managed_username()
    if not name or settings.PLATFORM_ADMIN_PASSWORD_HASH is None:
        return "not configured"
    current = marker(settings.PLATFORM_ADMIN_PASSWORD_HASH.get_secret_value())
    email = settings.PLATFORM_ADMIN_EMAIL or None

    user = db.query(User).filter(User.username == name).first()
    if user is None:
        user = User(
            username=name,
            email=email if email and _email_is_free(db, email, None) else None,
            full_name=DEFAULT_FULL_NAME,
            password_hash=current,
            is_active=True,
            is_platform_admin=True,
            company_id=None,
            branch_id=None,
            role_id=None,
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            # Another API instance created it first: take it from there, once.
            db.rollback()
            if not _retry:
                raise
            return sync(db, _retry=False)
        logger.info("Platform admin %s created from the Cloudflare secret", name)
        return "created"

    if not user.is_platform_admin or user.company_id is not None:
        # Never promote a mill's account just because its username matches.
        logger.error(
            "PLATFORM_ADMIN_USERNAME %s belongs to a mill's account; left alone. Choose another username.", name
        )
        return "refused"

    rotated = user.password_hash != current
    # Whoever swaps the password secret could swap the email one too: the warning
    # goes to the address the account had before.
    previous_email = user.email
    changed = rotated or not user.is_active or user.must_change_password or user.google_sub is not None
    user.password_hash = current
    user.is_active = True
    user.must_change_password = False
    user.temp_password_expires_at = None
    # Signing in with Google would go around the Cloudflare password.
    user.google_sub = None
    user.google_issuer = None
    if email and user.email != email and _email_is_free(db, email, user):
        user.email = email
        changed = True
    if rotated:
        db.query(AuthSession).filter(
            AuthSession.user_id == user.id,
            AuthSession.revoked_at.is_(None),
        ).update({AuthSession.revoked_at: now_utc()})
    db.commit()
    if rotated:
        # A new password is also the way out of a lockout.
        from ..services import platform_emails
        from .ratelimit import clear_login_failures

        clear_login_failures(name)
        logger.warning("Platform admin %s: new password from the Cloudflare secret; all sessions revoked", name)
        platform_emails.platform_admin_password_changed(user, to=previous_email)
        if user.email and user.email != previous_email:
            platform_emails.platform_admin_password_changed(user, to=user.email)
    return "updated" if changed else "unchanged"
