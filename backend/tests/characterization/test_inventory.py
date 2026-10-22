"""Characterization: inventory read shapes + manual stock add (Phase 3a target).

Pins the list/summary serialization the InventoryPage consumes, and the
owner-only add-stock upsert behavior.
"""

import uuid
from decimal import Decimal

from app.models.paddy import PalayInventory


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
    assert set(body.keys()) == {"palay_total_kg", "milled_rice_total_kg", "byproducts", "by_branch"}
    assert body["palay_total_kg"] == 0.0
    assert body["milled_rice_total_kg"] == 0.0
    assert body["byproducts"] == {}
    assert body["by_branch"] == []


def test_add_palay_stock_then_appears_in_summary(auth_client):
    variety = auth_client.post("/api/paddy/varieties", json={"code": "NSIC", "name": "NSIC Rc222"}).json()

    res = auth_client.post(
        "/api/inventory/stock",
        json={
            "inventory_type": "palay",
            "quantity_kg": "300",
            "variety_id": variety["id"],
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert set(body.keys()) == {"id", "inventory_type", "quantity_kg"}
    assert body["quantity_kg"] == 300.0

    summary = auth_client.get("/api/inventory/summary").json()
    assert summary["palay_total_kg"] == 300.0


def test_summary_adds_up_what_the_inventory_lists_show(auth_client, db_session, seed_owner):
    """The dashboard's figures are the Inventory page's: a by-product held in
    two warehouses is added up, and a row the lists hide (below zero) is left
    out of the totals too."""
    main = next(b for b in auth_client.get("/api/branches/").json() if b["is_main_branch"])
    variety = auth_client.post("/api/paddy/varieties", json={"code": "NSIC", "name": "NSIC Rc222"}).json()
    for branch_id, kg in ((main["id"], "100"), (None, "50")):
        res = auth_client.post(
            "/api/inventory/stock",
            json={"inventory_type": "byproduct", "byproduct_type": "ipa", "quantity_kg": kg, "branch_id": branch_id},
        )
        assert res.status_code == 201, res.text
    auth_client.post(
        "/api/inventory/stock",
        json={"inventory_type": "palay", "quantity_kg": "300", "variety_id": variety["id"]},
    )
    db_session.add(
        PalayInventory(
            company_id=seed_owner.company_id,
            branch_id=uuid.UUID(main["id"]),
            variety_id=uuid.UUID(variety["id"]),
            quantity_kg=Decimal("-20"),
        )
    )
    db_session.flush()

    summary = auth_client.get("/api/inventory/summary").json()
    palay = auth_client.get("/api/paddy/inventory").json()
    byproducts = auth_client.get("/api/inventory/byproducts").json()

    assert summary["byproducts"] == {"ipa": 150.0}
    assert summary["byproducts"]["ipa"] == sum(r["quantity_kg"] for r in byproducts)
    assert summary["palay_total_kg"] == 300.0
    assert summary["palay_total_kg"] == sum(r["quantity_kg"] for r in palay)
    assert sum(row["byproduct_kg"] for row in summary["by_branch"]) == 150.0


def test_add_stock_zero_quantity_422(auth_client):
    res = auth_client.post(
        "/api/inventory/stock",
        json={
            "inventory_type": "palay",
            "quantity_kg": "0",
            "variety_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert res.status_code == 422
