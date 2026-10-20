"""The platform admin whose password lives in Cloudflare, not the database.

PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD_HASH are Worker secrets. At
startup the API makes that username an active platform admin whose row keeps only
a marker; sign-in checks the password against the secret. A new secret signs the
admin out everywhere and warns the address the account had before. Inside the app
the password can't be changed, reset or replaced.
"""

from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

import app.services.platform_emails as emails
from app.core import platform_admin
from app.core.config import Settings, settings
from app.core.ratelimit import clear_login_failures
from app.core.security import hash_password
from app.models.auth_session import AuthSession
from app.models.base import now_utc
from app.models.password_reset import PasswordResetToken
from app.models.user import User

NAME = "cf.admin"
PASSWORD = "Cloudflare-Admin-2026"
NEW_PASSWORD = "Rotated-Admin-Pass-77"
NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


@pytest.fixture
def configured(monkeypatch):
    """Point the settings at a Cloudflare admin; returns a function to rotate it."""

    def use(password: str, email: str | None = "admin@oraiza.test") -> None:
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_USERNAME", NAME)
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_PASSWORD_HASH", SecretStr(hash_password(password)))
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_EMAIL", email)

    use(PASSWORD)
    clear_login_failures(NAME)
    yield use
    clear_login_failures(NAME)


@pytest.fixture
def sent(monkeypatch):
    mails: list[tuple[str | None, str, str]] = []
    monkeypatch.setattr(emails, "send_account_email", lambda to, subject, text: mails.append((to, subject, text)))
    return mails


def _sign_in(client, password: str, username: str = NAME):
    return client.post("/api/auth/login", data={"username": username, "password": password}, headers=NATIVE_HEADERS)


def _admin(db_session) -> User:
    return db_session.query(User).filter(User.username == NAME).one()


# ── configuration ────────────────────────────────────────────────────────────


def _settings(**values) -> Settings:
    return Settings(_env_file=None, DATABASE_URL="postgresql://u:p@localhost/db", ENV="test", **values)


def test_the_username_and_the_hash_come_together():
    with pytest.raises(ValidationError, match="set both or neither"):
        _settings(PLATFORM_ADMIN_USERNAME=NAME)
    with pytest.raises(ValidationError, match="set both or neither"):
        _settings(PLATFORM_ADMIN_PASSWORD_HASH=hash_password(PASSWORD))
    assert _settings().PLATFORM_ADMIN_USERNAME is None


def test_the_secret_must_be_a_hash_never_the_password():
    with pytest.raises(ValidationError, match="must be a bcrypt hash"):
        _settings(PLATFORM_ADMIN_USERNAME=NAME, PLATFORM_ADMIN_PASSWORD_HASH=PASSWORD)
    ok = _settings(PLATFORM_ADMIN_USERNAME=f" {NAME} ", PLATFORM_ADMIN_PASSWORD_HASH=hash_password(PASSWORD) + "\n")
    assert ok.PLATFORM_ADMIN_USERNAME == NAME


# ── the account ──────────────────────────────────────────────────────────────


def test_startup_creates_the_admin_without_its_password_hash(db_session, configured):
    assert platform_admin.sync(db_session) == "created"
    admin = _admin(db_session)
    assert admin.is_platform_admin and admin.is_active and admin.company_id is None
    assert admin.email == "admin@oraiza.test"
    assert admin.password_hash.startswith(platform_admin.MARKER_PREFIX)
    assert settings.PLATFORM_ADMIN_PASSWORD_HASH.get_secret_value() not in admin.password_hash
    assert platform_admin.sync(db_session) == "unchanged"


def test_the_admin_signs_in_with_the_cloudflare_password(client, db_session, configured):
    platform_admin.sync(db_session)
    assert _sign_in(client, PASSWORD).status_code == 200
    assert _sign_in(client, "Wrong-Password-123").status_code == 401
    # What the database holds is no way in either.
    assert _sign_in(client, _admin(db_session).password_hash).status_code == 401


def test_a_new_secret_replaces_the_password_and_signs_out_every_device(client, db_session, configured, sent):
    platform_admin.sync(db_session)
    admin = _admin(db_session)
    _sign_in(client, PASSWORD)
    assert db_session.query(AuthSession).filter(AuthSession.user_id == admin.id).count() == 1

    configured(NEW_PASSWORD, email="attacker@elsewhere.test")
    assert platform_admin.sync(db_session) == "updated"

    live = db_session.query(AuthSession).filter(AuthSession.user_id == admin.id, AuthSession.revoked_at.is_(None))
    assert live.count() == 0
    assert _sign_in(client, PASSWORD).status_code == 401
    assert _sign_in(client, NEW_PASSWORD).status_code == 200
    # The warning reaches the address the account had before the change.
    recipients = [to for to, subject, _ in sent if "password was changed" in subject]
    assert recipients[0] == "admin@oraiza.test"


def test_an_existing_platform_admin_is_taken_over(client, db_session, configured):
    db_session.add(
        User(
            username=NAME,
            full_name="Old Admin",
            password_hash=hash_password("Old-Database-Pass-1"),
            is_platform_admin=True,
            is_active=True,
            google_sub="google-123",
            google_issuer="https://accounts.google.com",
        )
    )
    db_session.flush()
    assert platform_admin.sync(db_session) == "updated"
    admin = _admin(db_session)
    assert admin.google_sub is None  # no way around the Cloudflare password
    assert _sign_in(client, "Old-Database-Pass-1").status_code == 401
    assert _sign_in(client, PASSWORD).status_code == 200


def test_a_mill_account_with_that_username_is_never_promoted(db_session, configured, seed_owner):
    seed_owner.username = NAME
    db_session.flush()
    assert platform_admin.sync(db_session) == "refused"
    assert not _admin(db_session).is_platform_admin


# ── no way to change it from inside the app ──────────────────────────────────


def test_the_app_cannot_change_reset_or_replace_the_password(client, db_session, configured):
    from app.core.security import get_current_user
    from app.main import app
    from app.services.auth_service import AuthService

    platform_admin.sync(db_session)
    admin = _admin(db_session)

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.post(
            "/api/auth/change-password",
            json={"current_password": PASSWORD, "new_password": "Another-Strong-Pass-9"},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert res.status_code == 400 and "Cloudflare" in res.text

    assert client.post("/api/auth/forgot-password", json={"identifier": NAME}).status_code == 200
    assert db_session.query(PasswordResetToken).filter(PasswordResetToken.user_id == admin.id).count() == 0

    with pytest.raises(Exception, match="Cloudflare"):
        AuthService(db_session).issue_temporary_password(admin, issued_by=admin)
    assert _sign_in(client, PASSWORD).status_code == 200


def test_a_reset_link_made_before_the_takeover_no_longer_works(client, db_session, configured):
    from datetime import timedelta

    from app.services.auth_service import _sha256

    platform_admin.sync(db_session)
    admin = _admin(db_session)
    db_session.add(
        PasswordResetToken(user_id=admin.id, token_hash=_sha256("old-link"), expires_at=now_utc() + timedelta(hours=1))
    )
    db_session.flush()
    res = client.post("/api/auth/reset-password", json={"token": "old-link", "new_password": "Another-Strong-Pass-9"})
    assert res.status_code == 400
    assert _sign_in(client, PASSWORD).status_code == 200
