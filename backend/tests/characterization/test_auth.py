"""Characterization: the auth domain (Phase 3 sensitive group).

Login/refresh/signup/me/password/profile. The feature-gate 402 path lives in
test_auth_and_gates.py.
"""

from app.models.subscription import SubscriptionPlan
from app.models.user import Role

NATIVE_HEADERS = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


def test_login_success_returns_tokens(client, seed_owner):
    res = client.post("/api/auth/login", data={"username": "owner", "password": "Password123"}, headers=NATIVE_HEADERS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["token_type"] == "bearer"


def test_login_bad_password_401(client, seed_owner):
    res = client.post("/api/auth/login", data={"username": "owner", "password": "nope"})
    assert res.status_code == 401


def test_refresh_issues_new_tokens(client, seed_owner):
    login = client.post(
        "/api/auth/login", data={"username": "owner", "password": "Password123"}, headers=NATIVE_HEADERS
    )
    refresh_token = login.json()["refresh_token"]
    res = client.post("/api/auth/refresh", json={"refresh_token": refresh_token}, headers=NATIVE_HEADERS)
    assert res.status_code == 200
    assert res.json()["access_token"]


def test_refresh_with_access_token_rejected_401(client, seed_owner):
    login = client.post(
        "/api/auth/login", data={"username": "owner", "password": "Password123"}, headers=NATIVE_HEADERS
    )
    access_token = login.json()["access_token"]
    res = client.post("/api/auth/refresh", json={"refresh_token": access_token}, headers=NATIVE_HEADERS)
    assert res.status_code == 401


def test_signup_creates_tenant_and_returns_tokens(client, db_session):
    db_session.add(Role(id=1, name="owner"))
    db_session.add(SubscriptionPlan(code="free", name="Free", features=[]))
    db_session.flush()

    res = client.post(
        "/api/auth/signup",
        headers=NATIVE_HEADERS,
        json={
            "company_name": "NewCo",
            "full_name": "New Owner",
            "username": "newowner",
            "email": "newowner@gmail.com",
            "password": "password123",
            "accepted_terms": True,
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["access_token"]


def test_signup_short_password_400(client, db_session):
    db_session.add(Role(id=1, name="owner"))
    db_session.flush()
    res = client.post(
        "/api/auth/signup",
        json={
            "company_name": "NewCo",
            "full_name": "X",
            "username": "shorty",
            "email": "shorty@gmail.com",
            "password": "short",
        },
    )
    assert res.status_code == 422


def test_me_returns_profile_with_features(auth_client, seed_owner):
    res = auth_client.get("/api/auth/me")
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "owner"
    assert "features" in body
    assert "subscription" in body


def test_change_password(auth_client):
    res = auth_client.post(
        "/api/auth/change-password",
        json={
            "current_password": "Password123",
            "new_password": "newpassword1",
        },
    )
    assert res.status_code == 200


def test_change_password_wrong_current_400(auth_client):
    res = auth_client.post(
        "/api/auth/change-password",
        json={
            "current_password": "wrong",
            "new_password": "newpassword1",
        },
    )
    assert res.status_code == 400


def test_update_profile(auth_client):
    res = auth_client.put("/api/auth/me", json={"full_name": "Updated Name"})
    assert res.status_code == 200
