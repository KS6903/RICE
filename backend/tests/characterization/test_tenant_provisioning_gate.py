"""The API queues production tenant setup but never performs DDL itself."""

import app.core.config as cfg

NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


def test_production_login_queues_unprovisioned_tenant(client, db_session, seed_owner, monkeypatch):
    monkeypatch.setattr(cfg.settings, "ENV", "prod")
    seed_owner.company.provisioned_at = None
    seed_owner.company.provisioning_requested_at = None
    db_session.flush()

    response = client.post(
        "/api/auth/login",
        data={"username": "owner", "password": "Password123"},
        headers=NATIVE_HEADERS,
    )

    assert response.status_code == 503
    assert response.json()["code"] == "service_unavailable"
    db_session.refresh(seed_owner.company)
    assert seed_owner.company.provisioning_requested_at is not None


def test_data_routes_fail_closed_until_tenant_is_provisioned(auth_client, db_session, seed_owner):
    seed_owner.company.provisioned_at = None
    db_session.flush()

    response = auth_client.get("/api/paddy/varieties")

    assert response.status_code == 503
    assert "setup is in progress" in response.json()["detail"].lower()


def test_preview_signup_without_verification_queues_the_tenant(client, db_session, monkeypatch):
    """The preview has no email verification, so signup queues the schema for
    the provisioner instead of running DDL with the API's DML-only role."""
    from pydantic import SecretStr

    from app.core.provisioning import QUEUED_HEADER
    from app.models.company import Company
    from app.models.subscription import SubscriptionPlan
    from app.models.user import Role

    monkeypatch.setattr(cfg.settings, "ENV", "preview")
    monkeypatch.setattr(cfg.settings, "REQUIRE_EMAIL_VERIFICATION", False)
    monkeypatch.setattr(cfg.settings, "SIGNUP_INVITE_CODE", SecretStr("invite-0123456789abcdef"))
    db_session.add(Role(id=1, name="owner"))
    db_session.add(SubscriptionPlan(code="free", name="Free", features=[]))
    db_session.flush()

    response = client.post(
        "/api/auth/signup",
        headers=NATIVE_HEADERS,
        json={
            "company_name": "Preview Mill",
            "full_name": "Preview Owner",
            "username": "previewowner",
            "email": "previewowner@gmail.com",
            "password": "password123",
            "accepted_terms": True,
            "invite_code": "invite-0123456789abcdef",
        },
    )

    assert response.status_code == 201, response.text
    assert response.headers.get(QUEUED_HEADER)
    company = db_session.query(Company).filter_by(name="Preview Mill").one()
    assert company.provisioned_at is None
    assert company.provisioning_requested_at is not None
