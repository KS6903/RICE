"""Edit power: the Boss lets a role correct records already saved, every change
logged. Not a page: one yes or no per role, beside its page levels."""

from __future__ import annotations

import pytest

from app.core.access_policy import custom_role_edit_power, edit_power_for_role
from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.activity import ActivityLog
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


def _power(client, role, on):
    return client.put(f"/api/role-access/{role}/edit-power", json={"on": on})


def _order(client):
    customer = client.post("/api/sales/customers", json={"name": "Power Co"}).json()
    res = client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-10-24",
            "items": [{"item_type": "milled_rice", "quantity_kg": "100", "unit_price_per_kg": "50"}],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_the_boss_gives_and_takes_edit_power_and_it_is_logged(client, act_as, db_session):
    act_as("owner")
    assert _role(client.get("/api/role-access/").json(), "accountant")["edit_power"] is False

    res = _power(client, "accountant", True)
    assert res.status_code == 200, res.text
    assert _role(res.json(), "accountant")["edit_power"] is True
    assert _role(res.json(), "cashier")["edit_power"] is False
    assert _role(res.json(), "owner")["edit_power"] is True

    assert _role(_power(client, "accountant", False).json(), "accountant")["edit_power"] is False
    logged = db_session.query(ActivityLog).filter_by(action="role_access.edit_power").all()
    assert [r.detail for r in logged] == ["on", "off"]


def test_with_edit_power_a_role_corrects_saved_records(client, act_as):
    act_as("owner")
    order = _order(client)

    act_as("accountant")
    refused = client.patch(f"/api/sales/orders/{order['id']}", json={"remarks": "corrected"})
    assert refused.status_code == 403
    assert "edit power" in refused.json()["detail"]
    assert client.get("/api/auth/me").json()["edit_power"] is False

    act_as("owner")
    _power(client, "accountant", True)

    act_as("accountant")
    assert client.get("/api/auth/me").json()["edit_power"] is True
    res = client.patch(f"/api/sales/orders/{order['id']}", json={"remarks": "corrected"})
    assert res.status_code == 200, res.text
    [entry] = client.get(f"/api/sales/history/sales_order/{order['id']}").json()
    assert entry["user_name"] == "Accountant"
    assert "Remarks: blank → corrected" in entry["detail"]


def test_saving_a_roles_pages_keeps_its_edit_power(client, act_as):
    act_as("owner")
    _power(client, "accountant", True)
    res = client.put("/api/role-access/accountant", json={"access": {"reports": "view"}})
    assert res.status_code == 200, res.text
    accountant = _role(res.json(), "accountant")
    assert accountant["access"]["reports"] == "view"
    assert accountant["edit_power"] is True


def test_the_boss_always_has_it(client, act_as):
    act_as("owner")
    res = _power(client, "owner", False)
    assert res.status_code == 400
    assert edit_power_for_role("owner") is True
    assert client.get("/api/auth/me").json()["edit_power"] is True


def test_a_made_up_role_gets_it_and_keeps_it_through_a_rename(client, act_as):
    act_as("owner")
    created = client.post("/api/role-access/custom", json={"name": "Checker", "access": {"sales": "full"}})
    role = created.json()["custom_roles"][0]
    assert role["edit_power"] is False

    res = client.put(f"/api/role-access/custom/{role['id']}/edit-power", json={"on": True})
    assert res.status_code == 200, res.text
    assert res.json()["custom_roles"][0]["edit_power"] is True

    renamed = client.put(f"/api/role-access/custom/{role['id']}", json={"name": "Auditor"})
    assert renamed.json()["custom_roles"][0]["edit_power"] is True


def test_nobody_hands_out_edit_power_they_dont_have(client, act_as):
    act_as("owner")
    # The accountant runs the Users page, but has no edit power; the cashier
    # role has it.
    client.put("/api/role-access/accountant", json={"access": {"users": "full"}})
    _power(client, "cashier", True)

    act_as("accountant")
    res = client.post(
        "/api/users/",
        json={"username": "till2", "password": "secret123", "full_name": "Second Till", "role_id": 3},
    )
    assert res.status_code == 403
    assert "edit saved records" in res.json()["detail"]


def test_edit_power_ignores_anything_but_a_true_flag():
    assert edit_power_for_role("accountant", {"accountant": {"edit_power": "yes"}}) is False
    assert edit_power_for_role("accountant", {"accountant": {"edit_power": True}}) is True
    assert edit_power_for_role("nobody", {"nobody": {"edit_power": True}}) is False
    assert custom_role_edit_power({"edit_power": 1}) is False
    assert custom_role_edit_power(None) is False
