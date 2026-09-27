"""Production configuration must keep DDL credentials out of the API process."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core import legal
from app.core.config import Settings


@pytest.fixture(autouse=True)
def _legal_docs_filled_in(monkeypatch):
    """Treat the published agreements as complete for this module.

    The prod validator also refuses to boot while legal/entity.json still holds
    TODO placeholders. That check has its own test below; these tests are about
    credential separation, so they should not start failing the day a legal
    document gains a new token.
    """
    monkeypatch.setattr(legal, "unresolved_placeholders", lambda: [])


def _valid_prod(**overrides):
    values = {
        "DATABASE_URL": ("postgresql://ricemill_app:runtime@db.internal:5432/ricemill" "?sslmode=require"),
        "SECRET_KEY": "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_",
        "ENV": "prod",
        "PROCESS_ROLE": "api",
        "ALLOWED_ORIGINS": "https://app.example.com",
        "TRUSTED_HOSTS": "api.example.com",
        "COOKIE_SECURE": True,
        "EXPOSE_RESET_TOKEN": False,
        "RATE_LIMIT_ENABLED": True,
        "MFA_ENFORCE": True,
        "MFA_REQUIRED_ROLES": "owner,admin",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_FROM_EMAIL": "security@example.com",
        "MFA_ENCRYPTION_KEY": "separate-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "SIGNUP_INVITE_CODE": "invite-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "REQUIRE_EMAIL_VERIFICATION": True,
        "PASSWORD_BREACH_CHECK": True,
        "FRONTEND_BASE_URL": "https://app.example.com",
        "REDIS_URL": "rediss://cache.internal:6379/0",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_api_accepts_only_runtime_database_credential():
    settings = _valid_prod()
    assert settings.PROCESS_ROLE == "api"
    assert settings.PROVISIONER_DATABASE_URL is None


def test_api_rejects_provisioner_credential_exposure():
    with pytest.raises(ValidationError, match="must not be exposed"):
        _valid_prod(PROVISIONER_DATABASE_URL=("postgresql://owner:ddl@db.internal:5432/ricemill?sslmode=require"))


def test_worker_requires_separate_provisioner_credential():
    with pytest.raises(ValidationError, match="required by the provisioning process"):
        _valid_prod(PROCESS_ROLE="provisioner")

    settings = _valid_prod(
        PROCESS_ROLE="provisioner",
        PROVISIONER_DATABASE_URL=("postgresql://owner:ddl@db.internal:5432/ricemill?sslmode=require"),
    )
    assert settings.PROVISIONER_DATABASE_URL is not None


def test_prod_refuses_to_boot_on_unfilled_legal_placeholders(monkeypatch):
    """A Terms of Service naming no legal entity is worse than none at all.

    It invites the argument that no agreement was formed, so an unfilled
    placeholder is treated as a release blocker rather than a cosmetic gap.
    """
    monkeypatch.setattr(
        legal,
        "unresolved_placeholders",
        lambda: ["terms-of-service.md: entity.json 'venue_city' is still a TODO placeholder"],
    )
    with pytest.raises(ValidationError, match="legal document placeholder unfilled"):
        _valid_prod()


def test_prod_refuses_to_boot_when_legal_documents_cannot_be_read(monkeypatch):
    """Missing documents must fail loudly, not be silently skipped."""

    def boom():
        raise FileNotFoundError("legal/ not deployed")

    monkeypatch.setattr(legal, "unresolved_placeholders", boom)
    with pytest.raises(ValidationError, match="legal documents could not be validated"):
        _valid_prod()
