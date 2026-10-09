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
        "DATABASE_URL": ("postgresql://ricemill_app:runtime@db.internal:5432/ricemill?sslmode=require"),
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


def test_jobs_process_rejects_the_provisioner_credential():
    with pytest.raises(ValidationError, match="must not be exposed to the jobs process"):
        _valid_prod(
            PROCESS_ROLE="jobs",
            PROVISIONER_DATABASE_URL="postgresql://owner:ddl@db.internal:5432/ricemill?sslmode=require",
        )
    assert _valid_prod(PROCESS_ROLE="jobs").PROCESS_ROLE == "jobs"


# ── The private preview (ENV=preview) ─────────────────────────────────────────
# Production behaviour and the same checks, except: the agreements may still
# say "To follow", and email (so also verification) is optional.


def _preview(**overrides):
    values = {
        "ENV": "preview",
        "SMTP_HOST": None,
        "SMTP_FROM_EMAIL": None,
        "REQUIRE_EMAIL_VERIFICATION": False,
        "ALLOWED_ORIGINS": "https://oryza-preview.example.workers.dev",
        "TRUSTED_HOSTS": "oryza-preview.example.workers.dev",
        "FRONTEND_BASE_URL": "https://oryza-preview.example.workers.dev",
    }
    values.update(overrides)
    return _valid_prod(**values)


def test_preview_boots_without_email_or_the_legal_details(monkeypatch):
    monkeypatch.setattr(legal, "unresolved_placeholders", lambda: ["terms-of-service.md: 'provider_legal_name'"])
    settings = _preview()
    assert settings.is_prod and settings.is_preview
    assert not settings.email_required


def test_production_still_requires_email_and_the_legal_details(monkeypatch):
    with pytest.raises(ValidationError, match="SMTP_HOST and SMTP_FROM_EMAIL are required"):
        _valid_prod(SMTP_HOST=None, SMTP_FROM_EMAIL=None)
    with pytest.raises(ValidationError, match="REQUIRE_EMAIL_VERIFICATION must be true"):
        _valid_prod(REQUIRE_EMAIL_VERIFICATION=False)
    monkeypatch.setattr(legal, "unresolved_placeholders", lambda: ["terms-of-service.md: 'provider_legal_name'"])
    with pytest.raises(ValidationError, match="legal document placeholder unfilled"):
        _valid_prod()


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"DEBUG": True}, "DEBUG must be false"),
        ({"COOKIE_SECURE": False}, "COOKIE_SECURE must be true"),
        ({"TRUSTED_HOSTS": "*"}, "TRUSTED_HOSTS must be an explicit allowlist"),
        ({"MFA_REQUIRED_ROLES": ""}, "MFA_REQUIRED_ROLES must include owner and admin"),
        ({"EXPOSE_RESET_TOKEN": True}, "EXPOSE_RESET_TOKEN must be false"),
        ({"REDIS_URL": "redis://cache.internal:6379/0"}, "REDIS_URL must use TLS"),
        ({"REQUIRE_EMAIL_VERIFICATION": True}, "needs SMTP_HOST and SMTP_FROM_EMAIL"),
    ],
)
def test_preview_keeps_every_other_production_check(override, message):
    with pytest.raises(ValidationError, match=message):
        _preview(**override)


def test_preview_with_email_may_require_verification():
    settings = _preview(
        SMTP_HOST="smtp.gmail.com", SMTP_FROM_EMAIL="oryza.preview@gmail.com", REQUIRE_EMAIL_VERIFICATION=True
    )
    assert settings.REQUIRE_EMAIL_VERIFICATION
