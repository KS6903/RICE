"""Password-reset flow (security hardening — phase 1).

Tokenized, single-use, expiring, enumeration-safe. A successful reset changes
the password and revokes every existing session. The raw token is surfaced in
the response only because EXPOSE_RESET_TOKEN is forced on for tests (see the
fixture); production delivers it by email.
"""

import pytest

from app.core.config import get_settings

NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


@pytest.fixture(autouse=True)
def _expose_reset_token(monkeypatch):
    """Surface the raw reset token in the API response so tests can use it."""
    monkeypatch.setenv("EXPOSE_RESET_TOKEN", "true")
    get_settings.cache_clear()
    import app.core.config as cfg
    monkeypatch.setattr(cfg.settings, "EXPOSE_RESET_TOKEN", True, raising=False)
    yield
    get_settings.cache_clear()


def _request_reset(client, identifier: str):
    return client.post("/api/auth/forgot-password", json={"identifier": identifier})


def test_forgot_password_is_enumeration_safe(client, seed_owner):
    known = _request_reset(client, "owner")
    unknown = _request_reset(client, "ghost-who-does-not-exist")
    assert known.status_code == 200
    assert unknown.status_code == 200
    # Identical message either way; a token is only minted for the real account.
    assert known.json()["message"] == unknown.json()["message"]
    assert "reset_token" in known.json()
    assert "reset_token" not in unknown.json()


def test_reset_password_changes_password_and_revokes_sessions(client, seed_owner):
    # Establish a live session first.
    login = client.post("/api/auth/login", data={"username": "owner", "password": "Password123"}, headers=NATIVE_HEADERS)
    refresh_token = login.json()["refresh_token"]
    client.cookies.clear()

    token = _request_reset(client, "owner@test.local").json()["reset_token"]
    res = client.post("/api/auth/reset-password", json={"token": token, "new_password": "brandNew99"})
    assert res.status_code == 200

    # Old password no longer works; new one does.
    assert client.post("/api/auth/login", data={"username": "owner", "password": "Password123"}).status_code == 401
    assert client.post("/api/auth/login", data={"username": "owner", "password": "brandNew99"}).status_code == 200

    # The pre-reset refresh session was revoked.
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh_token}, headers=NATIVE_HEADERS).status_code == 401


def test_reset_token_is_single_use(client, seed_owner):
    token = _request_reset(client, "owner").json()["reset_token"]
    first = client.post("/api/auth/reset-password", json={"token": token, "new_password": "firstChange1"})
    assert first.status_code == 200
    second = client.post("/api/auth/reset-password", json={"token": token, "new_password": "secondChange1"})
    assert second.status_code == 400


def test_requesting_a_new_token_invalidates_the_previous_one(client, seed_owner):
    first = _request_reset(client, "owner").json()["reset_token"]
    second = _request_reset(client, "owner").json()["reset_token"]
    assert first != second
    # The superseded token can no longer be used.
    assert client.post("/api/auth/reset-password", json={"token": first, "new_password": "newPass123"}).status_code == 400
    assert client.post("/api/auth/reset-password", json={"token": second, "new_password": "newPass123"}).status_code == 200


def test_reset_rejects_unknown_token(client, seed_owner):
    res = client.post("/api/auth/reset-password", json={"token": "not-a-real-token", "new_password": "whatever12"})
    assert res.status_code == 400


def test_reset_enforces_password_policy(client, seed_owner):
    token = _request_reset(client, "owner").json()["reset_token"]
    # Too short / no digit → policy rejection (and the token stays usable).
    weak = client.post("/api/auth/reset-password", json={"token": token, "new_password": "short"})
    assert weak.status_code == 400
    ok = client.post("/api/auth/reset-password", json={"token": token, "new_password": "strongPass1"})
    assert ok.status_code == 200
