"""Authenticated Google linking requires proof and immutable identity binding."""

import types

import app.core.config as cfg
import app.services.auth_service as auth_module


def _stub_google(monkeypatch, *, email: str, subject: str = "google-subject") -> None:
    monkeypatch.setattr(cfg.settings, "GOOGLE_CLIENT_ID", "test-client", raising=False)
    monkeypatch.setattr(
        auth_module,
        "id_token",
        types.SimpleNamespace(
            verify_oauth2_token=lambda *a, **k: {
                "email": email,
                "name": "Test Owner",
                "sub": subject,
                "iss": "accounts.google.com",
                "email_verified": True,
            }
        ),
        raising=False,
    )
    monkeypatch.setattr(
        auth_module,
        "google_requests",
        types.SimpleNamespace(Request=lambda: None),
        raising=False,
    )


def test_link_and_unlink_google_requires_current_password(auth_client, seed_owner, db_session, monkeypatch):
    seed_owner.email_verified = True
    db_session.flush()
    _stub_google(monkeypatch, email=seed_owner.email)

    denied = auth_client.post("/api/auth/google/link", json={"credential": "google-token"})
    assert denied.status_code == 403

    linked = auth_client.post(
        "/api/auth/google/link",
        json={"credential": "google-token", "current_password": "Password123"},
    )
    assert linked.status_code == 200, linked.text
    db_session.refresh(seed_owner)
    assert seed_owner.google_sub == "google-subject"

    unlinked = auth_client.post("/api/auth/google/unlink", json={"current_password": "Password123"})
    assert unlinked.status_code == 200, unlinked.text
    db_session.refresh(seed_owner)
    assert seed_owner.google_sub is None


def test_google_link_requires_same_verified_email(auth_client, seed_owner, db_session, monkeypatch):
    seed_owner.email_verified = True
    db_session.flush()
    _stub_google(monkeypatch, email="different@example.com")

    response = auth_client.post(
        "/api/auth/google/link",
        json={"credential": "google-token", "current_password": "Password123"},
    )
    assert response.status_code == 403
    db_session.refresh(seed_owner)
    assert seed_owner.google_sub is None
