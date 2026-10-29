"""Characterization: warehouses, the places a branch keeps its stock.

Every branch has at least one ("Warehouse 1 - <branch name>", made with it); the
Boss can add more. Purchases and stock say which warehouse they sit in.
"""

import uuid

from app.models.company import Branch
from app.models.paddy import PalayInventory, PalayPurchase
from app.models.warehouse import Warehouse

_ITEM = {"gross_weight_kg": "1000", "tare_weight_kg": "0", "price_per_cavan": "1200"}


def _main_branch(auth_client):
    return next(b for b in auth_client.get("/api/branches/").json() if b["is_main_branch"])


def _names(rows):
    return [w["name"] for w in rows]


def _add(c, branch_id, name=None):
    return c.post("/api/warehouses/", json={"branch_id": branch_id, "name": name})


def _buy(c, **extra):
    return c.post("/api/paddy/purchases", json={"purchase_date": "2026-10-30", "items": [_ITEM], **extra})


def test_every_branch_starts_with_warehouse_1_named_after_it(auth_client):
    main = _main_branch(auth_client)
    rows = auth_client.get("/api/warehouses/").json()
    assert _names(rows) == [f"Warehouse 1 - {main['name']}"]
    assert rows[0]["branch_id"] == main["id"]
    assert rows[0]["is_default"] is True


def test_a_new_branch_gets_its_first_warehouse(make_auth_client):
    c = make_auth_client(features=["multi_branch", "inventory"], username="wb")
    created = c.post("/api/branches/", json={"name": "Tarlac Branch"})
    assert created.status_code == 201, created.text
    rows = c.get("/api/warehouses/", params={"branch_id": created.json()["id"]}).json()
    assert _names(rows) == ["Warehouse 1 - Tarlac Branch"]
    assert rows[0]["is_default"] is True


def test_adding_a_warehouse_numbers_it_after_the_branchs_others(auth_client):
    main = _main_branch(auth_client)
    second = _add(auth_client, main["id"])
    assert second.status_code == 201, second.text
    assert second.json()["name"] == f"Warehouse 2 - {main['name']}"
    assert second.json()["is_default"] is False
    third = _add(auth_client, main["id"])
    assert third.json()["name"] == f"Warehouse 3 - {main['name']}"
    assert len(auth_client.get("/api/warehouses/").json()) == 3


def test_a_warehouse_can_be_given_its_own_name_but_not_a_taken_one(auth_client):
    main = _main_branch(auth_client)
    shed = _add(auth_client, main["id"], "Back shed")
    assert shed.json()["name"] == "Back shed"
    again = _add(auth_client, main["id"], "Back shed")
    assert again.status_code == 409


def test_a_warehouse_is_added_only_to_a_branch_of_the_company(auth_client):
    res = _add(auth_client, str(uuid.uuid4()))
    assert res.status_code == 404


def test_renaming_a_branch_renames_its_auto_named_warehouses_only(auth_client):
    main = _main_branch(auth_client)
    _add(auth_client, main["id"])  # "Warehouse 2 - <branch>"
    _add(auth_client, main["id"], "Back shed")
    assert auth_client.put(f"/api/branches/{main['id']}", json={"name": "Home Mill"}).status_code == 200
    names = _names(auth_client.get("/api/warehouses/").json())
    assert names == ["Warehouse 1 - Home Mill", "Warehouse 2 - Home Mill", "Back shed"]


def test_a_warehouse_can_be_renamed(auth_client):
    main = _main_branch(auth_client)
    shed = _add(auth_client, main["id"]).json()
    res = auth_client.put(f"/api/warehouses/{shed['id']}", json={"name": "Drying yard"})
    assert res.status_code == 200
    assert res.json()["name"] == "Drying yard"
    assert auth_client.put(f"/api/warehouses/{shed['id']}", json={"name": "  "}).status_code == 422


def test_purchase_without_a_warehouse_goes_to_the_branchs_first(auth_client, db_session):
    first = auth_client.get("/api/warehouses/").json()[0]
    res = _buy(auth_client)
    assert res.status_code == 201, res.text
    assert res.json()["warehouse"]["id"] == first["id"]
    stock = db_session.query(PalayInventory).one()
    assert str(stock.warehouse_id) == first["id"]


def test_purchases_into_two_warehouses_keep_two_stock_rows(auth_client, db_session):
    main = _main_branch(auth_client)
    first = auth_client.get("/api/warehouses/").json()[0]
    shed = _add(auth_client, main["id"]).json()
    assert _buy(auth_client, warehouse_id=shed["id"]).status_code == 201
    assert _buy(auth_client).status_code == 201

    stock = {str(r.warehouse_id): r for r in db_session.query(PalayInventory).all()}
    assert set(stock) == {first["id"], shed["id"]}
    assert all(r.quantity_kg == 1000 for r in stock.values())

    rows = auth_client.get("/api/paddy/inventory").json()
    assert {r["warehouse"]["name"] for r in rows} == {first["name"], shed["name"]}
    # Narrowed to one warehouse, only its stock shows.
    only = auth_client.get("/api/paddy/inventory", params={"warehouse_id": shed["id"]}).json()
    assert [r["warehouse_id"] for r in only] == [shed["id"]]
    assert (
        auth_client.get("/api/inventory/summary", params={"warehouse_id": shed["id"]}).json()["palay_total_kg"] == 1000
    )


def test_a_purchase_cant_go_into_another_branchs_warehouse(auth_client, db_session, seed_owner):
    other = Branch(company_id=seed_owner.company_id, name="2nd Branch", is_main_branch=False)
    db_session.add(other)
    db_session.flush()
    theirs = _add(auth_client, str(other.id)).json()
    res = _buy(auth_client, warehouse_id=theirs["id"])
    assert res.status_code == 404
    assert res.json()["detail"] == "Warehouse not found."
    assert db_session.query(PalayPurchase).count() == 0


def test_a_warehouse_that_holds_nothing_can_be_deleted_but_not_the_last_one(auth_client):
    main = _main_branch(auth_client)
    first = auth_client.get("/api/warehouses/").json()[0]
    # The only one stays.
    assert auth_client.delete(f"/api/warehouses/{first['id']}").status_code == 409
    shed = _add(auth_client, main["id"]).json()
    assert auth_client.delete(f"/api/warehouses/{shed['id']}").status_code == 200
    assert _names(auth_client.get("/api/warehouses/").json()) == [first["name"]]


def test_a_warehouse_with_stock_cant_be_deleted(auth_client):
    main = _main_branch(auth_client)
    shed = _add(auth_client, main["id"]).json()
    assert _buy(auth_client, warehouse_id=shed["id"]).status_code == 201
    res = auth_client.delete(f"/api/warehouses/{shed['id']}")
    assert res.status_code == 409
    assert "stock" in res.json()["detail"]


def test_deleting_the_first_warehouse_hands_that_role_to_the_next(auth_client, db_session):
    main = _main_branch(auth_client)
    first = auth_client.get("/api/warehouses/").json()[0]
    shed = _add(auth_client, main["id"]).json()
    assert auth_client.delete(f"/api/warehouses/{first['id']}").status_code == 200
    left = db_session.get(Warehouse, uuid.UUID(shed["id"]))
    assert left.is_default is True


def test_adding_stock_by_hand_goes_into_the_warehouse_picked(auth_client, db_session):
    main = _main_branch(auth_client)
    shed = _add(auth_client, main["id"]).json()
    res = auth_client.post(
        "/api/inventory/stock",
        json={
            "inventory_type": "byproduct",
            "byproduct_type": "darak",
            "quantity_kg": "300",
            "branch_id": main["id"],
            "warehouse_id": shed["id"],
        },
    )
    assert res.status_code in (200, 201), res.text
    rows = auth_client.get("/api/inventory/byproducts").json()
    assert [r["warehouse"]["id"] for r in rows] == [shed["id"]]
