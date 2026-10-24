"""Characterization: the users domain (Phase 3 target)."""

from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.activity import ActivityLog
from app.models.subscription import Subscription
from app.models.user import User

# Making someone a Boss or an Admin asks the signed-in person to confirm with
# their own password (the seeded owner's, and _add_user's, is this one).
CONFIRM = {"current_password": "Password123"}

SAFE_USER_FIELDS = {
    "id",
    "company_id",
    "branch_id",
    "username",
    "email",
    "full_name",
    "role_id",
    "role",
    "custom_role_id",
    "custom_role",
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
    res = auth_client.post(
        "/api/users/",
        json={
            "username": "newuser",
            "password": "secret123",
            "full_name": "New User",
            "role_id": 2,
            **CONFIRM,
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["username"] == "newuser"
    assert set(res.json()) == SAFE_USER_FIELDS
    assert not (set(res.json()) & SENSITIVE_USER_FIELDS)


def test_create_user_duplicate_username_400(auth_client):
    auth_client.post(
        "/api/users/",
        json={
            "username": "dupe",
            "password": "secret123",
            "full_name": "Dupe",
            "role_id": 2,
            **CONFIRM,
        },
    )
    dup = auth_client.post(
        "/api/users/",
        json={
            "username": "dupe",
            "password": "secret123",
            "full_name": "Dupe",
            "role_id": 2,
            **CONFIRM,
        },
    )
    assert dup.status_code == 400
    assert "already exists" in dup.json()["detail"]


def test_people_added_without_an_email_have_none(auth_client, db_session):
    """A blank email is no email: stored as "", the second account added
    without one broke the database's unique rule (an internal server error)."""
    for name in ("first", "second"):
        res = auth_client.post(
            "/api/users/",
            json={"username": name, "email": " ", "password": "secret123", "full_name": name, "role_id": 2, **CONFIRM},
        )
        assert res.status_code == 201, res.text
        assert res.json()["email"] is None


def test_an_email_already_in_use_is_refused_plainly(auth_client, db_session, seed_owner):
    taken = seed_owner.email
    assert taken
    res = auth_client.post(
        "/api/users/",
        json={
            "username": "copycat",
            "email": taken.upper(),
            "password": "secret123",
            "full_name": "C",
            "role_id": 2,
            **CONFIRM,
        },
    )
    assert res.status_code == 400
    assert "already used" in res.json()["detail"]

    other = _add_user(db_session, seed_owner, "clerk")
    res = auth_client.put(f"/api/users/{other.id}", json={"email": taken})
    assert res.status_code == 400
    # Blank takes the email off.
    assert auth_client.put(f"/api/users/{other.id}", json={"email": ""}).json()["email"] is None


def test_create_user_denied_for_cashier(make_auth_client):
    c = make_auth_client(features=["users"], username="cash", role_name="cashier")
    res = c.post(
        "/api/users/",
        json={
            "username": "x",
            "password": "secret123",
            "full_name": "X",
            "role_id": 2,
        },
    )
    assert res.status_code == 403


def test_list_users_denied_for_non_management_roles(make_auth_client):
    for role_name in ("accountant", "cashier", "mill_operator", "encoder"):
        c = make_auth_client(features=["users"], username=f"read-{role_name}", role_name=role_name)
        assert c.get("/api/users/").status_code == 403


# --- Editing and removing users ------------------------------------------------
# Removing is a deactivation (is_active=False): the account can't sign in and
# stops taking a seat, but its history stays.


def _add_user(db_session, owner, username, role_id=2):
    user = User(
        company_id=owner.company_id,
        branch_id=owner.branch_id,
        username=username,
        password_hash=hash_password("Password123"),
        full_name=username.title(),
        role_id=role_id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


def test_nobody_can_remove_their_own_account(auth_client, seed_owner):
    res = auth_client.put(f"/api/users/{seed_owner.id}", json={"is_active": False})
    assert res.status_code == 400
    assert "your own account" in res.json()["detail"]


def test_nobody_can_change_their_own_role(auth_client, seed_owner):
    res = auth_client.put(f"/api/users/{seed_owner.id}", json={"role_id": 2})
    assert res.status_code == 400
    assert "your own role" in res.json()["detail"]


def test_own_name_can_still_be_edited(auth_client, seed_owner):
    res = auth_client.put(f"/api/users/{seed_owner.id}", json={"full_name": "Renamed Owner"})
    assert res.status_code == 200, res.text
    assert res.json()["full_name"] == "Renamed Owner"


def test_owner_can_edit_remove_and_restore_another_user(auth_client, db_session, seed_owner):
    other = _add_user(db_session, seed_owner, "clerk")

    edited = auth_client.put(f"/api/users/{other.id}", json={"full_name": "Head Clerk", "email": "c@x.ph"})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["full_name"], edited.json()["email"]) == ("Head Clerk", "c@x.ph")

    removed = auth_client.put(f"/api/users/{other.id}", json={"is_active": False})
    assert removed.status_code == 200, removed.text
    assert removed.json()["is_active"] is False

    restored = auth_client.put(f"/api/users/{other.id}", json={"is_active": True})
    assert restored.status_code == 200, restored.text
    assert restored.json()["is_active"] is True


def test_removing_a_user_frees_their_seat(auth_client, db_session, seed_owner):
    sub = db_session.query(Subscription).filter_by(company_id=seed_owner.company_id).one()
    sub.plan.max_users = 2
    db_session.flush()
    other = _add_user(db_session, seed_owner, "clerk")  # owner + clerk: the plan is full
    new = {"username": "newhire", "password": "secret123", "full_name": "New Hire", "role_id": 2, **CONFIRM}

    assert auth_client.post("/api/users/", json=new).status_code == 402
    assert auth_client.put(f"/api/users/{other.id}", json={"is_active": False}).status_code == 200
    assert auth_client.post("/api/users/", json=new).status_code == 201
    # The plan is full again, so the removed user can't be restored.
    restore = auth_client.put(f"/api/users/{other.id}", json={"is_active": True})
    assert restore.status_code == 402


def test_an_admin_cannot_touch_an_owner_or_make_one(client, db_session, seed_owner):
    admin = _add_user(db_session, seed_owner, "manager", role_id=2)
    clerk = _add_user(db_session, seed_owner, "clerk", role_id=2)
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        assert client.put(f"/api/users/{seed_owner.id}", json={"is_active": False}).status_code == 403
        assert client.put(f"/api/users/{seed_owner.id}", json={"full_name": "X"}).status_code == 403
        assert client.put(f"/api/users/{clerk.id}", json={"role_id": 1}).status_code == 403
        # Everyone else is fair game.
        assert client.put(f"/api/users/{clerk.id}", json={"is_active": False}).status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_an_admin_cannot_create_a_boss_either(client, db_session, seed_owner):
    admin = _add_user(db_session, seed_owner, "manager", role_id=2)
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        body = {"username": "newboss", "password": "secret123", "full_name": "New Boss"}
        res = client.post("/api/users/", json={**body, "role_id": 1})
        assert res.status_code == 403
        assert "Only the Boss" in res.json()["detail"]
        assert client.post("/api/users/", json={**body, "role_id": 2, **CONFIRM}).status_code == 201
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_account_changes_go_in_the_activity_log(auth_client, db_session, seed_owner):
    """Who added, re-roled, removed or restored which account, for the company's
    Settings and the platform admin's records."""
    created = auth_client.post(
        "/api/users/",
        json={"username": "logged", "password": "secret123", "full_name": "Logged", "role_id": 2, **CONFIRM},
    ).json()
    uid = created["id"]
    auth_client.put(f"/api/users/{uid}", json={"full_name": "Renamed"})  # not logged
    auth_client.put(f"/api/users/{uid}", json={"role_id": 1, **CONFIRM})
    auth_client.put(f"/api/users/{uid}", json={"is_active": False})
    auth_client.put(f"/api/users/{uid}", json={"is_active": True})

    rows = db_session.query(ActivityLog).filter_by(entity_type="user", entity_label="logged").all()
    assert sorted(r.action for r in rows) == ["user.create", "user.remove", "user.restore", "user.role_change"]
    assert {r.user_id for r in rows} == {seed_owner.id}
    by_action = {r.action: r for r in rows}
    assert by_action["user.create"].detail == "Role: admin"
    assert by_action["user.role_change"].detail == "admin → owner"
