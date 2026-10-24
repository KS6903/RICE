"""The by-products a mill handles: ipa, darak and binlid for every mill, and the
ones its Boss adds on Stock > Catalog. Records keep a by-product's code, so a
rename or a hidden one never changes them."""

from __future__ import annotations

import pytest

from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.reference import ByproductKind
from app.models.user import Role, User
from app.services.byproduct_kind_service import code_for

URL = "/api/byproduct-kinds/"


@pytest.fixture
def act_as(db_session, seed_owner):
    users = {"owner": seed_owner}
    role = Role(id=3, name="cashier")
    db_session.add(role)
    db_session.flush()
    users["cashier"] = User(
        company_id=seed_owner.company_id,
        branch_id=seed_owner.branch_id,
        username="till",
        email="till@test.local",
        password_hash=hash_password("Password123"),
        full_name="Till",
        role_id=role.id,
        is_active=True,
    )
    db_session.add(users["cashier"])
    db_session.flush()

    def _act_as(name):
        app.dependency_overrides[get_current_user] = lambda: users[name]

    yield _act_as
    app.dependency_overrides.pop(get_current_user, None)


def _codes(res):
    return [k["code"] for k in res.json()]


def test_every_mill_starts_with_ipa_darak_and_binlid(client, act_as):
    act_as("owner")
    res = client.get(URL)
    assert res.status_code == 200, res.text
    assert [(k["code"], k["built_in"]) for k in res.json()] == [
        ("ipa", True),
        ("darak", True),
        ("binlid", True),
    ]


def test_the_boss_adds_renames_and_hides_one(client, act_as):
    act_as("owner")
    res = client.post(URL, json={"name": "  Darak  D1 "})
    assert res.status_code == 201, res.text
    d1 = res.json()
    assert (d1["code"], d1["name"], d1["built_in"]) == ("darak_d1", "Darak D1", False)
    client.post(URL, json={"name": "Carbonized hull"})
    assert _codes(client.get(URL)) == ["ipa", "darak", "binlid", "carbonized_hull", "darak_d1"]

    renamed = client.patch(f"{URL}{d1['id']}", json={"name": "First-class bran"})
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["code"], renamed.json()["name"]) == ("darak_d1", "First-class bran")

    client.patch(f"{URL}{d1['id']}", json={"is_active": False})
    assert "darak_d1" not in _codes(client.get(URL))
    hidden = next(k for k in client.get(URL, params={"include_hidden": True}).json() if k["code"] == "darak_d1")
    assert hidden["is_active"] is False


def test_a_name_already_on_the_list_is_refused(client, act_as):
    act_as("owner")
    client.post(URL, json={"name": "Tahop"})
    for name in ("tahop", "Darak (rice bran)", "Ipa", "   ", "!!!"):
        res = client.post(URL, json={"name": name})
        assert res.status_code in (409, 422), (name, res.status_code)
    assert _codes(client.get(URL)) == ["ipa", "darak", "binlid", "tahop"]


def test_one_typed_in_on_a_purchase_or_stock_joins_the_list(client, act_as):
    act_as("owner")
    res = client.post(
        "/api/paddy/byproduct-purchases",
        json={
            "purchase_date": "2026-10-24",
            "items": [
                {"byproduct_type": "Tahop", "weight_kg": "100", "price_per_kg": "3"},
                {"byproduct_type": "darak", "weight_kg": "100", "price_per_kg": "14"},
            ],
        },
    )
    assert res.status_code == 201, res.text
    res = client.post(
        "/api/inventory/stock",
        json={"inventory_type": "byproduct", "byproduct_type": "tahop", "quantity_kg": "50"},
    )
    assert res.status_code == 201, res.text
    res = client.post(
        "/api/inventory/stock",
        json={"inventory_type": "byproduct", "byproduct_type": "rice_straw", "quantity_kg": "50"},
    )
    assert res.status_code == 201, res.text

    kinds = {k["code"]: k["name"] for k in client.get(URL).json()}
    assert kinds == {
        "ipa": "Ipa (Rice Hull)",
        "darak": "Darak (Rice Bran)",
        "binlid": "Binlid (Broken Rice)",
        "rice_straw": "Rice straw",
        "tahop": "Tahop",
    }


def test_staff_read_the_list_but_only_an_editor_changes_it(client, act_as, db_session):
    act_as("owner")
    made = client.post(URL, json={"name": "Tahop"}).json()

    act_as("cashier")
    assert _codes(client.get(URL)) == ["ipa", "darak", "binlid", "tahop"]
    assert client.post(URL, json={"name": "Straw"}).status_code == 403
    assert client.patch(f"{URL}{made['id']}", json={"is_active": False}).status_code == 403
    assert db_session.query(ByproductKind).count() == 1


def test_codes_are_short_slugs():
    assert code_for("Darak D1") == "darak_d1"
    assert code_for("  Ipa / ash (carbonized)  ") == "ipa_ash_carbonized"
    assert code_for("A very long by-product name indeed") == "a_very_long_by_produ"
    assert code_for("!!!") == ""


def test_the_demo_seeder_adds_three_once(db_session, seed_owner):
    import seed_demo_byproducts

    first = seed_demo_byproducts.seed(db_session, seed_owner.username)
    assert first == f"{seed_owner.username}: by-products Carbonized rice hull, Darak D1, Rice straw"
    shown = {k.code: k.is_active for k in db_session.query(ByproductKind).all()}
    assert shown == {"carbonized_rice_hull": True, "darak_d1": True, "rice_straw": False}

    again = seed_demo_byproducts.seed(db_session, seed_owner.username)
    assert again == f"{seed_owner.username}: by-products already seeded"
    assert db_session.query(ByproductKind).count() == 3
