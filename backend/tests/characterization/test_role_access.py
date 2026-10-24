"""Characterization: the Boss decides which pages each role can open, and makes
up roles of their own."""

import pytest

from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.activity import ActivityLog
from app.models.company import Company
from app.models.user import CompanyRole, Role, User


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

    # Every page, the ones that used to be fixed included.
    for page in ("reports", "employees", "dashboard", "tasks", "settings", "users"):
        assert page in data["sections"]

    assert _role(data, "owner")["editable"] is False
    assert _role(data, "admin")["editable"] is True
    assert data["custom_roles"] == []
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


def test_the_boss_cannot_be_changed(client, act_as):
    act_as("owner")
    res = _put(client, "owner", {"reports": "none"})
    assert res.status_code == 400
    assert "always has full access" in res.json()["detail"]


def test_the_admin_can_be_narrowed(client, act_as):
    act_as("owner")
    res = _put(client, "admin", {"users": "none", "reports": "view"})
    assert res.status_code == 200, res.text
    admin = _role(res.json(), "admin")
    assert admin["access"]["users"] == "none"
    assert admin["access"]["reports"] == "view"


def test_settings_and_users_can_be_opened_to_a_role(client, act_as):
    act_as("cashier")
    assert client.get("/api/activity/").status_code == 403
    assert client.get("/api/users/").status_code == 403

    act_as("owner")
    assert _put(client, "cashier", {"settings": "view", "users": "view"}).status_code == 200

    act_as("cashier")
    assert client.get("/api/activity/").status_code == 200
    assert client.get("/api/users/").status_code == 200
    # View only: no new branch, no new user.
    assert client.post("/api/branches/", json={"name": "Annex"}).status_code == 403


def test_everyone_keeps_the_branch_list_and_their_own_places(client, act_as):
    act_as("cashier")
    assert client.get("/api/branches/").status_code == 200
    assert client.get("/api/branches/company").status_code == 200
    assert client.get("/api/locations").status_code == 200


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


# ── roles the Boss makes up ──────────────────────────────────────────────────


def _custom(data, name):
    return next(r for r in data["custom_roles"] if r["name"] == name)


def _make(client, name="Warehouse Manager", access=None):
    return client.post(
        "/api/role-access/custom",
        json={"name": name, "access": access if access is not None else {"inventory": "full", "reports": "view"}},
    )


def test_the_boss_makes_up_a_role_with_its_own_pages(client, act_as, db_session, seed_owner):
    act_as("owner")
    res = _make(client)
    assert res.status_code == 201, res.text
    role = _custom(res.json(), "Warehouse Manager")
    assert role["access"]["inventory"] == "full"
    assert role["access"]["reports"] == "view"
    assert role["access"]["sales"] == "none"
    assert role["people"] == 0

    stored = db_session.query(CompanyRole).filter_by(company_id=seed_owner.company_id).one()
    assert stored.name == "Warehouse Manager"


def test_someone_given_a_made_up_role_opens_its_pages(client, act_as, db_session, seed_owner):
    act_as("owner")
    role_id = _custom(_make(client).json(), "Warehouse Manager")["id"]
    res = client.post(
        "/api/users/",
        json={"username": "keeper", "password": "secret123", "full_name": "Stock Keeper", "custom_role_id": role_id},
    )
    assert res.status_code == 201, res.text
    assert res.json()["custom_role"]["name"] == "Warehouse Manager"
    assert res.json()["role_id"] is None

    keeper = db_session.query(User).filter_by(username="keeper").one()
    app.dependency_overrides[get_current_user] = lambda: keeper
    me = client.get("/api/auth/me").json()
    assert me["role"] is None
    assert me["role_label"] == "Warehouse Manager"
    assert me["access"]["inventory"] == "full"
    assert me["access"]["sales"] == "none"
    assert client.get("/api/reports/revenue-annual").status_code == 200
    assert client.get("/api/sales/orders").status_code == 403


def test_changing_a_made_up_role_changes_what_its_people_open(client, act_as):
    act_as("owner")
    role_id = _custom(_make(client).json(), "Warehouse Manager")["id"]
    res = client.put(f"/api/role-access/custom/{role_id}", json={"name": "Stockroom", "access": {"sales": "view"}})
    assert res.status_code == 200, res.text
    role = _custom(res.json(), "Stockroom")
    assert role["access"]["sales"] == "view"
    assert role["access"]["inventory"] == "none"


@pytest.mark.parametrize("name", ["Admin", "cashier", " boss ", "Mill operator"])
def test_a_made_up_role_cannot_pass_for_a_built_in_one(client, act_as, name):
    act_as("owner")
    res = _make(client, name)
    assert res.status_code == 400
    assert "already a role" in res.json()["detail"]


def test_two_made_up_roles_cannot_share_a_name(client, act_as):
    act_as("owner")
    assert _make(client).status_code == 201
    res = _make(client, "warehouse  manager")
    assert res.status_code == 400
    assert "already a role" in res.json()["detail"]


def test_a_role_that_still_has_people_cannot_be_deleted(client, act_as):
    act_as("owner")
    role_id = _custom(_make(client).json(), "Warehouse Manager")["id"]
    client.post(
        "/api/users/",
        json={"username": "keeper", "password": "secret123", "full_name": "Stock Keeper", "custom_role_id": role_id},
    )
    res = client.delete(f"/api/role-access/custom/{role_id}")
    assert res.status_code == 400
    assert "Give them another role first" in res.json()["detail"]


def test_someone_removed_from_the_mill_does_not_hold_a_role_up(client, act_as, db_session, seed_owner):
    act_as("owner")
    role_id = _custom(_make(client).json(), "Warehouse Manager")["id"]
    res = client.post(
        "/api/users/",
        json={"username": "keeper", "password": "secret123", "full_name": "Stock Keeper", "custom_role_id": role_id},
    )
    keeper_id = res.json()["id"]
    assert client.put(f"/api/users/{keeper_id}", json={"is_active": False}).status_code == 200
    assert _custom(client.get("/api/role-access/").json(), "Warehouse Manager")["people"] == 0

    assert client.delete(f"/api/role-access/custom/{role_id}").status_code == 200
    db_session.expire_all()
    assert db_session.query(User).filter_by(username="keeper").one().custom_role_id is None


def test_an_unused_role_can_be_deleted(client, act_as, db_session, seed_owner):
    act_as("owner")
    role_id = _custom(_make(client).json(), "Warehouse Manager")["id"]
    res = client.delete(f"/api/role-access/custom/{role_id}")
    assert res.status_code == 200, res.text
    assert res.json()["custom_roles"] == []
    assert db_session.query(CompanyRole).filter_by(company_id=seed_owner.company_id).count() == 0


def test_only_the_boss_makes_up_roles(client, act_as):
    act_as("owner")
    assert _put(client, "accountant", {"users": "full"}).status_code == 200
    act_as("accountant")
    assert _make(client).status_code == 403


def test_another_mills_role_cannot_be_given_or_changed(client, act_as, db_session):
    other = Company(name="Elsewhere")
    db_session.add(other)
    db_session.flush()
    theirs = CompanyRole(company_id=other.id, name="Theirs", access={"reports": "full"})
    db_session.add(theirs)
    db_session.flush()

    act_as("owner")
    assert client.put(f"/api/role-access/custom/{theirs.id}", json={"name": "Mine"}).status_code == 404
    assert client.delete(f"/api/role-access/custom/{theirs.id}").status_code == 404
    res = client.post(
        "/api/users/",
        json={"username": "stray", "password": "secret123", "full_name": "Stray", "custom_role_id": str(theirs.id)},
    )
    assert res.status_code == 400


# ── whoever runs the Users page can't give more than they have ───────────────


def test_staff_running_users_cannot_hand_out_more_than_they_have(client, act_as):
    act_as("owner")
    assert _put(client, "accountant", {"users": "full"}).status_code == 200
    big = _custom(_make(client, "Big", {"settings": "full", "reports": "full"}).json(), "Big")["id"]

    act_as("accountant")
    new = {"username": "helper", "password": "secret123", "full_name": "Helper"}
    # The Admin opens more than the accountant (Users with edit, Settings, ...).
    res = client.post("/api/users/", json={**new, "role_id": 2})
    assert res.status_code == 403
    assert "only the Boss can give it" in res.json()["detail"]
    # So does a made-up role with Settings.
    assert client.post("/api/users/", json={**new, "custom_role_id": big}).status_code == 403
    # A cashier opens nothing the accountant can't.
    assert client.post("/api/users/", json={**new, "role_id": 3}).status_code == 201


def test_staff_running_users_cannot_change_someone_who_opens_more(client, act_as, db_session, seed_owner):
    act_as("owner")
    assert _put(client, "accountant", {"users": "full"}).status_code == 200
    admin = User(
        company_id=seed_owner.company_id,
        username="manager",
        password_hash=hash_password("Password123"),
        full_name="Manager",
        role_id=2,
        is_active=True,
    )
    db_session.add(admin)
    db_session.flush()

    act_as("accountant")
    res = client.put(f"/api/users/{admin.id}", json={"is_active": False})
    assert res.status_code == 403
    assert client.put(f"/api/users/{seed_owner.id}", json={"full_name": "X"}).status_code == 403
