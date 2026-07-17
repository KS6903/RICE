"""Production configuration must keep DDL credentials out of the API process."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _valid_prod(**overrides):
    values = {
        "DATABASE_URL": (
            "postgresql://ricemill_app:runtime@db.internal:5432/ricemill"
            "?sslmode=require"
        ),
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
        _valid_prod(
            PROVISIONER_DATABASE_URL=(
                "postgresql://owner:ddl@db.internal:5432/ricemill?sslmode=require"
            )
        )


def test_worker_requires_separate_provisioner_credential():
    with pytest.raises(ValidationError, match="required by the provisioning process"):
        _valid_prod(PROCESS_ROLE="provisioner")

    settings = _valid_prod(
        PROCESS_ROLE="provisioner",
        PROVISIONER_DATABASE_URL=(
            "postgresql://owner:ddl@db.internal:5432/ricemill?sslmode=require"
        ),
    )
    assert settings.PROVISIONER_DATABASE_URL is not None
