"""Characterization: the users domain (Phase 3 target)."""


SAFE_USER_FIELDS = {
    "id",
    "company_id",
    "branch_id",
    "username",
    "email",
    "full_name",
    "role_id",
    "role",
    "is_active",
    "last_login",
    "email_verified",
    "created_at",
    "updated_at",
}

SENSITIVE_USER_FIELDS = {
    "password",
    "password_hash",
    "mfa_secret",
    "mfa_enabled",
    "mfa_backup_codes",
    "email_verification_hash",
    "email_verification_expires",
    "password_reset_token",
    "reset_token",
}


def test_list_users_includes_self(auth_client, seed_owner):
    rows = auth_client.get("/api/users/").json()
    assert any(u["username"] == "owner" for u in rows)


def test_list_users_returns_only_allowlisted_safe_fields(auth_client):
    response = auth_client.get("/api/users/")
    assert response.status_code == 200, response.text
    row = response.json()[0]
    assert set(row) == SAFE_USER_FIELDS
    assert not (set(row) & SENSITIVE_USER_FIELDS)
    assert set(row["role"]) == {"id", "name"}


def test_create_user_201(auth_client):
    res = auth_client.post("/api/users/", json={
        "username": "newuser", "password": "secret123", "full_name": "New User", "role_id": 2,
    })
    assert res.status_code == 201, res.text
    assert res.json()["username"] == "newuser"
    assert set(res.json()) == SAFE_USER_FIELDS
    assert not (set(res.json()) & SENSITIVE_USER_FIELDS)


def test_create_user_duplicate_username_400(auth_client):
    auth_client.post("/api/users/", json={
        "username": "dupe", "password": "secret123", "full_name": "Dupe", "role_id": 2,
    })
    dup = auth_client.post("/api/users/", json={
        "username": "dupe", "password": "secret123", "full_name": "Dupe", "role_id": 2,
    })
    assert dup.status_code == 400
    assert "already exists" in dup.json()["detail"]


def test_create_user_denied_for_cashier(make_auth_client):
    c = make_auth_client(features=["users"], username="cash", role_name="cashier")
    res = c.post("/api/users/", json={
        "username": "x", "password": "secret123", "full_name": "X", "role_id": 2,
    })
    assert res.status_code == 403


def test_list_users_denied_for_non_management_roles(make_auth_client):
    for role_name in ("accountant", "cashier", "mill_operator", "encoder"):
        c = make_auth_client(features=["users"], username=f"read-{role_name}", role_name=role_name)
        assert c.get("/api/users/").status_code == 403
