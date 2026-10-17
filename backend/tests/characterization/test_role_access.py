"""Characterization: the Boss decides which pages each staff role can open."""

import pytest

from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.activity import ActivityLog
from app.models.company import Company
from app.models.user import Role, User


@pytest.fixture
def act_as(db_session, seed_owner):
    """The Boss, a cashier and an accountant in one mill, and a way to be any of them."""
    users = {"owner": seed_owner}
    for role_id, name in ((3, "cashier"), (4, "accountant")):
        role = Role(id=role_id, name=name)
        db_session.add(role)
        db_session.flush()
        user = User(
            company_id=seed_owner.company_id,
            branch_id=seed_owner.branch_id,
            username=name,
            email=f"{name}@test.local",
            password_hash=hash_password("Password123"),
            full_name=name.title(),
            role_id=role.id,
            is_active=True,
        )
        db_session.add(user)
        users[name] = user
    db_session.flush()

    def _act_as(name):
        app.dependency_overrides[get_current_user] = lambda: users[name]

    yield _act_as
    app.dependency_overrides.pop(get_current_user, None)


def _role(data, name):
    return next(r for r in data["roles"] if r["role"] == name)


def _put(client, role, access):
    return client.put(f"/api/role-access/{role}", json={"access": access})


# ── reading the matrix ───────────────────────────────────────────────────────


def test_the_boss_reads_every_roles_access_and_what_can_be_changed(client, act_as):
    act_as("owner")
    res = client.get("/api/role-access/")
    assert res.status_code == 200, res.text
    data = res.json()

    assert "reports" in data["sections"] and "employees" in data["sections"]
    assert set(data["locked_sections"]) == {"dashboard", "tasks", "settings", "users"}
    assert not set(data["sections"]) & set(data["locked_sections"])

    assert _role(data, "owner")["editable"] is False
    assert _role(data, "admin")["editable"] is False
    cashier = _role(data, "cashier")
    assert cashier["editable"] is True
    assert cashier["access"]["reports"] == "none"
    assert cashier["access"] == cashier["defaults"]


def test_staff_who_cannot_open_users_cannot_read_it(client, act_as):
    act_as("cashier")
    assert client.get("/api/role-access/").status_code == 403


# ── opening and closing pages ────────────────────────────────────────────────


def test_a_page_the_boss_opens_to_a_role_opens_for_that_role(client, act_as, db_session, seed_owner):
    act_as("cashier")
    assert client.get("/api/reports/revenue-annual").status_code == 403

    act_as("owner")
    res = _put(client, "cashier", {"reports": "view"})
    assert res.status_code == 200, res.text
    assert _role(res.json(), "cashier")["access"]["reports"] == "view"

    db_session.expire_all()
    assert db_session.get(Company, seed_owner.company_id).role_access == {"cashier": {"reports": "view"}}

    act_as("cashier")
    assert client.get("/api/reports/revenue-annual").status_code == 200


def test_view_only_does_not_let_the_role_write(client, act_as):
    act_as("owner")
    assert _put(client, "cashier", {"employees": "view"}).status_code == 200
    act_as("cashier")
    assert client.get("/api/employees/").status_code == 200
    assert client.post("/api/employees/", json={"first_name": "A", "last_name": "B"}).status_code == 403

    act_as("owner")
    assert _put(client, "cashier", {"employees": "full"}).status_code == 200
    act_as("cashier")
    assert client.post("/api/employees/", json={"first_name": "A", "last_name": "B"}).status_code == 201


def test_a_page_the_boss_takes_away_closes_for_that_role_only(client, act_as):
    act_as("accountant")
    assert client.get("/api/employees/").status_code == 200

    act_as("owner")
    assert _put(client, "accountant", {"employees": "none"}).status_code == 200
    assert client.get("/api/employees/").status_code == 200  # the Boss is not narrowed

    act_as("accountant")
    assert client.get("/api/employees/").status_code == 403


def test_sending_nothing_puts_a_role_back_to_the_defaults(client, act_as, db_session, seed_owner):
    act_as("owner")
    _put(client, "cashier", {"reports": "view"})
    res = _put(client, "cashier", {})
    assert res.status_code == 200
    assert _role(res.json(), "cashier")["access"] == _role(res.json(), "cashier")["defaults"]

    db_session.expire_all()
    assert db_session.get(Company, seed_owner.company_id).role_access is None
    act_as("cashier")
    assert client.get("/api/reports/revenue-annual").status_code == 403


def test_only_what_differs_from_the_default_is_stored(client, act_as, db_session, seed_owner):
    act_as("owner")
    # Paddy is already "none" for a cashier, so naming it again changes nothing.
    _put(client, "cashier", {"reports": "view", "paddy": "none"})
    db_session.expire_all()
    assert db_session.get(Company, seed_owner.company_id).role_access == {"cashier": {"reports": "view"}}


def test_each_roles_changes_are_kept_apart(client, act_as):
    act_as("owner")
    _put(client, "cashier", {"reports": "view"})
    res = _put(client, "accountant", {"employees": "none"})
    data = res.json()
    assert _role(data, "cashier")["access"]["reports"] == "view"
    assert _role(data, "accountant")["access"]["employees"] == "none"
    assert _role(data, "accountant")["access"]["reports"] == "full"


# ── what cannot be changed, and who can change it ────────────────────────────


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_the_boss_and_admin_cannot_be_changed(client, act_as, role):
    act_as("owner")
    res = _put(client, role, {"reports": "none"})
    assert res.status_code == 400
    assert "always have full access" in res.json()["detail"]


@pytest.mark.parametrize("page", ["users", "settings", "dashboard", "tasks"])
def test_locked_pages_cannot_be_opened_to_a_role(client, act_as, page):
    act_as("owner")
    res = _put(client, "cashier", {page: "full"})
    assert res.status_code == 400
    assert "can't be changed here" in res.json()["detail"]


def test_unknown_roles_pages_and_levels_are_refused(client, act_as):
    act_as("owner")
    assert _put(client, "ghost", {}).status_code == 400
    assert _put(client, "cashier", {"not_a_page": "view"}).status_code == 400
    assert _put(client, "cashier", {"reports": "superuser"}).status_code == 422


def test_only_the_boss_can_change_it(client, act_as):
    act_as("accountant")
    assert _put(client, "cashier", {"reports": "view"}).status_code == 403
    act_as("cashier")
    assert _put(client, "cashier", {"reports": "full"}).status_code == 403


def test_a_change_in_one_mill_does_not_reach_another(client, act_as, db_session):
    other = Company(name="Elsewhere")
    db_session.add(other)
    db_session.flush()

    act_as("owner")
    assert _put(client, "cashier", {"reports": "view"}).status_code == 200

    db_session.expire_all()
    assert db_session.get(Company, other.id).role_access is None


# ── what the app is told, and the record ─────────────────────────────────────


def test_me_tells_the_app_what_the_person_can_open(client, act_as):
    act_as("cashier")
    before = client.get("/api/auth/me").json()["access"]
    assert before["reports"] == "none"
    assert before["sales"] == "full"

    act_as("owner")
    _put(client, "cashier", {"reports": "view"})
    act_as("cashier")
    assert client.get("/api/auth/me").json()["access"]["reports"] == "view"


def test_each_change_is_written_to_the_activity_log(client, act_as, db_session):
    act_as("owner")
    _put(client, "cashier", {"reports": "view"})
    _put(client, "cashier", {})
    rows = (
        db_session.query(ActivityLog)
        .filter(ActivityLog.action == "role_access.update")
        .order_by(ActivityLog.created_at)
        .all()
    )
    assert [r.entity_label for r in rows] == ["cashier", "cashier"]
    assert rows[0].detail == "reports: view"
    assert rows[1].detail == "back to the defaults"
