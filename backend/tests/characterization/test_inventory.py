"""Characterization: inventory read shapes + manual stock add (Phase 3a target).

Pins the list/summary serialization the InventoryPage consumes, and the
owner-only add-stock upsert behavior.
"""


def test_milled_rice_empty_is_list(auth_client):
    res = auth_client.get("/api/inventory/milled-rice")
    assert res.status_code == 200
    assert res.json() == []


def test_byproducts_empty_is_list(auth_client):
    res = auth_client.get("/api/inventory/byproducts")
    assert res.status_code == 200
    assert res.json() == []


def test_summary_shape(auth_client):
    res = auth_client.get("/api/inventory/summary")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {
        "palay_total_kg", "milled_rice_total_kg", "byproducts", "by_branch"
    }
    assert body["palay_total_kg"] == 0.0
    assert body["milled_rice_total_kg"] == 0.0
    assert body["byproducts"] == {}
    assert body["by_branch"] == []


def test_add_palay_stock_then_appears_in_summary(auth_client):
    variety = auth_client.post(
        "/api/paddy/varieties", json={"code": "NSIC", "name": "NSIC Rc222"}
    ).json()

    res = auth_client.post("/api/inventory/stock", json={
        "inventory_type": "palay",
        "quantity_kg": "300",
        "variety_id": variety["id"],
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert set(body.keys()) == {"id", "inventory_type", "quantity_kg"}
    assert body["quantity_kg"] == 300.0

    summary = auth_client.get("/api/inventory/summary").json()
    assert summary["palay_total_kg"] == 300.0


def test_add_stock_zero_quantity_422(auth_client):
    res = auth_client.post("/api/inventory/stock", json={
        "inventory_type": "palay",
        "quantity_kg": "0",
        "variety_id": "00000000-0000-0000-0000-000000000000",
    })
    assert res.status_code == 422
