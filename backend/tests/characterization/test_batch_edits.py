"""Edit power reaches milling: someone with it corrects a saved batch. When its
palay, its outputs or its client change, the batch's stock is put right in
its warehouse, and every change is logged, field by field, in its history."""

from __future__ import annotations


def _ok(res, code=200):
    assert res.status_code == code, res.text
    return res.json()


def _variety(c, code):
    return _ok(c.post("/api/paddy/varieties", json={"code": code, "name": f"NSIC {code}"}), 201)


def _stock(c, variety_id):
    palay = c.get("/api/paddy/inventory").json()
    rice = c.get("/api/inventory/milled-rice").json()
    byproducts: dict[str, float] = {}
    for b in c.get("/api/inventory/byproducts").json():
        byproducts[b["byproduct_type"]] = byproducts.get(b["byproduct_type"], 0) + b["quantity_kg"]
    return (
        sum(p["quantity_kg"] for p in palay if p["variety"] and p["variety"]["id"] == variety_id),
        sum(m["quantity_kg"] for m in rice if m["variety"] and m["variety"]["id"] == variety_id),
        byproducts,
    )


def _batch(c, variety, seed_owner, **extra):
    _ok(
        c.post(
            "/api/inventory/stock",
            json={
                "inventory_type": "palay",
                "quantity_kg": "2000",
                "branch_id": str(seed_owner.branch_id),
                "variety_id": variety["id"],
            },
        ),
        201,
    )
    return _ok(
        c.post(
            "/api/milling/batches",
            json={
                "start_datetime": "2026-10-20T00:00:00Z",
                "inputs": [{"variety_id": variety["id"], "input_weight_kg": "1000"}],
                "outputs": [
                    {"output_type": "milled_rice", "variety_id": variety["id"], "output_weight_kg": "640"},
                    {"output_type": "darak", "output_weight_kg": "90"},
                ],
                **extra,
            },
        ),
        201,
    )


def _history(c, batch_id):
    return _ok(c.get(f"/api/milling/history/milling_batch/{batch_id}"))


def test_a_batch_corrected_puts_its_stock_right(auth_client, seed_owner):
    variety = _variety(auth_client, "TB216")
    batch = _batch(auth_client, variety, seed_owner)
    assert _stock(auth_client, variety["id"]) == (1000.0, 640.0, {"darak": 90.0})

    # 1,200 kg went in, not 1,000; 780 kg of rice came out, and binlid too.
    res = auth_client.patch(
        f"/api/milling/batches/{batch['id']}",
        json={
            "inputs": [{"variety_id": variety["id"], "input_weight_kg": "1200", "moisture_content_pct": "14"}],
            "outputs": [
                {"output_type": "milled_rice", "variety_id": variety["id"], "output_weight_kg": "780"},
                {"output_type": "darak", "output_weight_kg": "90"},
                {"output_type": "binlid", "output_weight_kg": "30", "broken_rice_pct": "4"},
            ],
        },
    )
    edited = _ok(res)
    rice = next(o for o in edited["outputs"] if o["output_type"] == "milled_rice")
    assert float(rice["milling_recovery_pct"]) == 65.0

    assert _stock(auth_client, variety["id"]) == (800.0, 780.0, {"darak": 90.0, "binlid": 30.0})

    [entry] = _history(auth_client, batch["id"])
    assert entry["detail"].splitlines() == [
        "Palay in: TB216, 1,000 kg → TB216, 1,200 kg, 14% moisture",
        "Out: Milled rice TB216, 640 kg; Darak (Rice Bran), 90 kg"
        " → Milled rice TB216, 780 kg; Darak (Rice Bran), 90 kg; Binlid (Broken Rice), 30 kg, 4% broken",
    ]


def test_a_batch_found_to_be_a_clients_gives_the_stock_back(auth_client, seed_owner):
    variety = _variety(auth_client, "TB160")
    batch = _batch(auth_client, variety, seed_owner)
    client = _ok(auth_client.post("/api/milling/clients", json={"name": "Mang Ador", "phone": "0917"}), 201)

    _ok(
        auth_client.patch(
            f"/api/milling/batches/{batch['id']}",
            json={"customer_id": client["id"], "client_arrangement": "mill_keeps_byproducts"},
        )
    )
    # The palay was the client's, and only the darak stays with the mill.
    assert _stock(auth_client, variety["id"]) == (2000.0, 0.0, {"darak": 90.0})

    [entry] = _history(auth_client, batch["id"])
    assert entry["detail"].splitlines() == [
        "Client: blank → Mang Ador",
        "Arrangement: blank → mill_keeps_byproducts",
    ]


def test_a_remark_alone_leaves_the_stock_alone(auth_client, seed_owner):
    variety = _variety(auth_client, "TB222")
    batch = _batch(auth_client, variety, seed_owner)
    before = _stock(auth_client, variety["id"])
    _ok(
        auth_client.patch(
            f"/api/milling/batches/{batch['id']}",
            json={"remarks": "Huller 2", "start_datetime": "2026-10-20T00:00:00Z"},
        )
    )
    assert _stock(auth_client, variety["id"]) == before
    [entry] = _history(auth_client, batch["id"])
    assert entry["detail"] == "Remarks: blank → Huller 2"
    assert auth_client.patch(f"/api/milling/batches/{batch['id']}", json={"start_datetime": None}).status_code == 422


def test_without_edit_power_a_batch_stays_as_saved(make_auth_client):
    operator = make_auth_client(["milling"], username="op", role_name="mill_operator")
    res = operator.patch("/api/milling/batches/00000000-0000-0000-0000-000000000001", json={"remarks": "x"})
    assert res.status_code == 403
    assert "edit power" in res.json()["detail"]
