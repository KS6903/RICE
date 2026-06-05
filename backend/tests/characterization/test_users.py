"""Characterization: the users domain (Phase 3 target)."""


def test_list_users_includes_self(auth_client, seed_owner):
    rows = auth_client.get("/api/users/").json()
    assert any(u["username"] == "owner" for u in rows)


def test_create_user_201(auth_client):
    res = auth_client.post("/api/users/", json={
        "username": "newuser", "password": "secret123", "full_name": "New User", "role_id": 2,
    })
    assert res.status_code == 201, res.text
    assert res.json()["username"] == "newuser"


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
