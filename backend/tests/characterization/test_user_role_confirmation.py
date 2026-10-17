"""Characterization: making someone a Boss or an Admin asks the signed-in person
to confirm, with their own password and, if they use two-factor, an authenticator
code. Any other role asks for nothing."""

import time

import pyotp
import pytest

from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.user import Role, User

PASSWORD = "Password123"  # the seeded owner's, and _add_user's
BOSS, ADMIN, CASHIER = 1, 2, 5


@pytest.fixture(autouse=True)
def _cashier_role(seed_owner, db_session):
    """The seeded company only has the Boss and Admin roles; add one that asks
    for no confirmation."""
    if db_session.get(Role, CASHIER) is None:
        db_session.add(Role(id=CASHIER, name="cashier"))
        db_session.flush()


def _new(role_id, username="newcomer", **extra):
    return {
        "username": username,
        "password": "secret123",
        "full_name": "New Comer",
        "role_id": role_id,
        **extra,
    }


def _add_user(db_session, owner, username, role_id=ADMIN):
    user = User(
        company_id=owner.company_id,
        branch_id=owner.branch_id,
        username=username,
        password_hash=hash_password(PASSWORD),
        full_name=username.title(),
        role_id=role_id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _enroll(auth_client) -> str:
    """Turn two-factor on for the seeded owner; return the authenticator secret."""
    secret = auth_client.post("/api/auth/mfa/enroll").json()["secret"]
    res = auth_client.post("/api/auth/mfa/enroll/verify", json={"code": pyotp.TOTP(secret).now()})
    assert res.status_code == 200, res.text
    return secret


def _next_code(secret: str) -> str:
    # The enrolment used this time step; the next one is the first code allowed.
    return pyotp.TOTP(secret).at(time.time() + 30)


# ── creating a Boss or an Admin ──────────────────────────────────────────────


def test_a_boss_needs_the_signed_in_persons_password(auth_client):
    missing = auth_client.post("/api/users/", json=_new(BOSS))
    assert missing.status_code == 400
    assert "password" in missing.json()["detail"].lower()
    # The page uses this code to ask again in its popup.
    assert missing.json()["code"] == "confirm_failed"

    wrong = auth_client.post("/api/users/", json=_new(BOSS, current_password="not-it"))
    assert wrong.status_code == 400
    assert "incorrect" in wrong.json()["detail"]
    assert wrong.json()["code"] == "confirm_failed"

    ok = auth_client.post("/api/users/", json=_new(BOSS, current_password=PASSWORD))
    assert ok.status_code == 201, ok.text
    assert ok.json()["role"]["name"] == "owner"


def test_an_admin_needs_it_too(auth_client):
    assert auth_client.post("/api/users/", json=_new(ADMIN)).status_code == 400
    ok = auth_client.post("/api/users/", json=_new(ADMIN, current_password=PASSWORD))
    assert ok.status_code == 201, ok.text


def test_other_roles_need_nothing(auth_client):
    res = auth_client.post("/api/users/", json=_new(CASHIER))
    assert res.status_code == 201, res.text


def test_a_refused_confirmation_creates_nobody(auth_client):
    auth_client.post("/api/users/", json=_new(BOSS, username="ghost", current_password="nope"))
    names = {u["username"] for u in auth_client.get("/api/users/").json()}
    assert "ghost" not in names


def test_the_new_persons_password_is_not_the_confirmation(auth_client):
    # "secret123" is the new account's password; it must not stand in for ours.
    res = auth_client.post("/api/users/", json=_new(BOSS, current_password="secret123"))
    assert res.status_code == 400


def test_an_admin_confirms_with_their_own_password(client, db_session, seed_owner):
    admin = _add_user(db_session, seed_owner, "manager", ADMIN)
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        assert client.post("/api/users/", json=_new(ADMIN)).status_code == 400
        assert client.post("/api/users/", json=_new(ADMIN, current_password="wrong")).status_code == 400
        ok = client.post("/api/users/", json=_new(ADMIN, current_password=PASSWORD))
        assert ok.status_code == 201, ok.text
        # An Admin still can't make a Boss, with or without confirming.
        boss = client.post("/api/users/", json=_new(BOSS, username="x", current_password=PASSWORD))
        assert boss.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ── with two-factor on ───────────────────────────────────────────────────────


def test_two_factor_adds_the_authenticator_code(auth_client):
    secret = _enroll(auth_client)

    no_code = auth_client.post("/api/users/", json=_new(BOSS, current_password=PASSWORD))
    assert no_code.status_code == 400
    assert "authenticator" in no_code.json()["detail"]

    bad = auth_client.post("/api/users/", json=_new(BOSS, current_password=PASSWORD, mfa_code="000000"))
    assert bad.status_code == 400
    assert "authentication code" in bad.json()["detail"]

    code = _next_code(secret)
    ok = auth_client.post("/api/users/", json=_new(BOSS, current_password=PASSWORD, mfa_code=code))
    assert ok.status_code == 201, ok.text


def test_a_code_cannot_confirm_twice(auth_client):
    secret = _enroll(auth_client)
    code = _next_code(secret)
    first = auth_client.post("/api/users/", json=_new(BOSS, username="one", current_password=PASSWORD, mfa_code=code))
    assert first.status_code == 201, first.text
    again = auth_client.post("/api/users/", json=_new(ADMIN, username="two", current_password=PASSWORD, mfa_code=code))
    assert again.status_code == 400


def test_a_code_alone_is_not_enough(auth_client):
    secret = _enroll(auth_client)
    res = auth_client.post("/api/users/", json=_new(BOSS, mfa_code=_next_code(secret)))
    assert res.status_code == 400
    assert "password" in res.json()["detail"].lower()


def test_other_roles_still_need_no_code(auth_client):
    _enroll(auth_client)
    assert auth_client.post("/api/users/", json=_new(CASHIER)).status_code == 201


# ── promoting someone who is already on the staff ────────────────────────────


def test_promoting_to_boss_or_admin_is_confirmed(auth_client, db_session, seed_owner):
    clerk = _add_user(db_session, seed_owner, "clerk", CASHIER)
    for role in (BOSS, ADMIN):
        assert auth_client.put(f"/api/users/{clerk.id}", json={"role_id": role}).status_code == 400
        wrong = auth_client.put(f"/api/users/{clerk.id}", json={"role_id": role, "current_password": "x"})
        assert wrong.status_code == 400
    ok = auth_client.put(f"/api/users/{clerk.id}", json={"role_id": ADMIN, "current_password": PASSWORD})
    assert ok.status_code == 200, ok.text
    assert ok.json()["role"]["name"] == "admin"


def test_the_confirmation_is_not_saved_on_the_account(auth_client, db_session, seed_owner):
    clerk = _add_user(db_session, seed_owner, "clerk", CASHIER)
    res = auth_client.put(f"/api/users/{clerk.id}", json={"role_id": ADMIN, "current_password": PASSWORD})
    assert res.status_code == 200, res.text
    db_session.refresh(clerk)
    assert not hasattr(clerk, "current_password")
    assert clerk.password_hash != PASSWORD


def test_editing_someone_who_keeps_their_role_asks_nothing(auth_client, db_session, seed_owner):
    admin = _add_user(db_session, seed_owner, "manager", ADMIN)
    # The edit form sends the role every time, even when it was not changed.
    res = auth_client.put(f"/api/users/{admin.id}", json={"role_id": ADMIN, "full_name": "Renamed"})
    assert res.status_code == 200, res.text
    assert res.json()["full_name"] == "Renamed"


def test_moving_someone_down_to_another_role_asks_nothing(auth_client, db_session, seed_owner):
    admin = _add_user(db_session, seed_owner, "manager", ADMIN)
    res = auth_client.put(f"/api/users/{admin.id}", json={"role_id": CASHIER})
    assert res.status_code == 200, res.text


def test_promoting_with_two_factor_needs_the_code(auth_client, db_session, seed_owner):
    secret = _enroll(auth_client)
    clerk = _add_user(db_session, seed_owner, "clerk", CASHIER)
    body = {"role_id": ADMIN, "current_password": PASSWORD}
    assert auth_client.put(f"/api/users/{clerk.id}", json=body).status_code == 400
    ok = auth_client.put(f"/api/users/{clerk.id}", json={**body, "mfa_code": _next_code(secret)})
    assert ok.status_code == 200, ok.text
