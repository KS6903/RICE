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


def test_batch_records_the_client_it_was_milled_for(auth_client):
    client = auth_client.post("/api/milling/clients", json={"name": "Mang Jose", "phone": "09171234567"})
    assert client.status_code == 201, client.text
    client = client.json()
    listed = auth_client.get("/api/milling/clients").json()
    assert {"id": client["id"], "name": "Mang Jose", "is_active": True} in listed
    # Name only: the milling side never sees a customer's credit terms.
    assert all(set(c) == {"id", "name", "is_active"} for c in listed)

    res = auth_client.post(
        "/api/milling/batches",
        json={
            "customer_id": client["id"],
            "start_datetime": "2026-06-05T08:00:00Z",
            "inputs": [{"input_weight_kg": "1000"}],
            "outputs": [{"output_type": "milled_rice", "output_weight_kg": "650"}],
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["customer_id"] == client["id"]

    batch = next(b for b in auth_client.get("/api/milling/batches").json() if b["id"] == res.json()["id"])
    assert batch["customer_id"] == client["id"]
    # The list carries each batch's kilos for the Inputs and Milled Rice columns.
    assert float(batch["inputs"][0]["input_weight_kg"]) == 1000.0
    assert float(batch["outputs"][0]["output_weight_kg"]) == 650.0


def test_batch_refuses_an_unknown_client(auth_client):
    res = auth_client.post(
        "/api/milling/batches",
        json={
            "customer_id": "00000000-0000-4000-8000-000000000000",
            "start_datetime": "2026-06-05T08:00:00Z",
            "inputs": [{"input_weight_kg": "100"}],
        },
    )
    assert res.status_code == 404, res.text
