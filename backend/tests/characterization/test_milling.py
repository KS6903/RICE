"""Characterization: the milling domain (Phase 3c target).

Pins equipment CRUD and the batch-create flow that deducts palay stock and
rolls milled-rice/by-product output into inventory, plus the batch-number format.
"""

import re


def _variety(c, code="MILL"):
    return c.post("/api/paddy/varieties", json={"code": code, "name": "Mill Variety"}).json()


def test_create_equipment_201(auth_client):
    res = auth_client.post("/api/milling/equipment", json={"name": "Mill A"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Mill A"
    assert body["is_active"] is True


def test_list_equipment_excludes_inactive(auth_client):
    eq = auth_client.post("/api/milling/equipment", json={"name": "Mill B"}).json()
    auth_client.put(f"/api/milling/equipment/{eq['id']}", json={"is_active": False})
    default = auth_client.get("/api/milling/equipment").json()
    assert all(e["id"] != eq["id"] for e in default)
    incl = auth_client.get("/api/milling/equipment", params={"include_inactive": True}).json()
    assert any(e["id"] == eq["id"] for e in incl)


def test_create_batch_deducts_palay_and_adds_milled_rice(auth_client, seed_owner):
    variety = _variety(auth_client)
    # Seed 1000kg palay on the owner's branch (so the batch input can deduct it).
    auth_client.post(
        "/api/inventory/stock",
        json={
            "inventory_type": "palay",
            "quantity_kg": "1000",
            "branch_id": str(seed_owner.branch_id),
            "variety_id": variety["id"],
        },
    )

    res = auth_client.post(
        "/api/milling/batches",
        json={
            "start_datetime": "2026-06-05T08:00:00Z",
            "inputs": [{"variety_id": variety["id"], "input_weight_kg": "500"}],
            "outputs": [
                {
                    "output_type": "milled_rice",
                    "variety_id": variety["id"],
                    "output_weight_kg": "300",
                    "grade_name": "regular",
                }
            ],
        },
    )
    assert res.status_code == 201, res.text
    batch = res.json()
    assert re.match(r"^MB-\d{8}-\d{4}$", batch["batch_no"]), batch["batch_no"]
    assert batch["status"] == "in_progress"

    # Milled rice inventory gained 300kg of the variety.
    milled = auth_client.get("/api/inventory/milled-rice").json()
    mine = [m for m in milled if m["variety"] and m["variety"]["id"] == variety["id"]]
    assert mine and mine[0]["quantity_kg"] == 300.0

    # Palay stock dropped 1000 -> 500.
    palay = auth_client.get("/api/paddy/inventory").json()
    pmine = [p for p in palay if p["variety"] and p["variety"]["id"] == variety["id"]]
    assert pmine and pmine[0]["quantity_kg"] == 500.0
