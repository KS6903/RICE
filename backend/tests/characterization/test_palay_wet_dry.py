"""Palay counted in sacks, bought wet or dry, and the stock view the Boss picks.

A palay line is counted in sacks; cavans and kilos are optional (kilos not weighed
are taken from the cavans, or else the sacks at 50 kg). A line bought wet is red
(the purchase "received") until its after-drying weight and moisture are recorded;
then it's green and the purchase "completed", and the stock holds the dried weight.
"""

from __future__ import annotations

from app.models.paddy import DryingRecord, PalayInventory, PalayInventoryMovement


def _ok(res, code=200):
    assert res.status_code == code, res.text
    return res.json()


def _variety(c, code="NSIC Rc 222"):
    every = _ok(c.get("/api/paddy/varieties"))
    return next(v for v in every if v["code"] == code and v["company_id"] is None)


def _buy(c, **line):
    line = {"variety_id": _variety(c)["id"], "price_per_cavan": "1200", **line}
    return _ok(c.post("/api/paddy/purchases", json={"purchase_date": "2026-10-29", "items": [line]}), 201)


def _stock(c):
    [row] = _ok(c.get("/api/paddy/inventory"))
    return row


# ── counted in sacks ─────────────────────────────────────────────────────────


def test_a_line_counted_only_in_sacks_is_taken_at_50_kg_each(auth_client):
    purchase = _buy(auth_client, sack_count="20")
    [line] = purchase["items"]
    assert float(line["sack_count"]) == 20
    assert float(line["gross_weight_kg"]) == 1000
    assert float(line["cavan_count"]) == 20
    assert purchase["total_kg"] == 1000.0
    assert purchase["total_amount"] == 24000.0
    assert purchase["status"] == "completed"
    assert purchase["is_drying"] is False
    assert _stock(auth_client)["quantity_kg"] == 1000.0


def test_cavans_stand_in_for_kilos_that_were_not_weighed(auth_client):
    [line] = _buy(auth_client, sack_count="30", cavan_count="25")["items"]
    assert float(line["gross_weight_kg"]) == 1250
    assert float(line["cavan_count"]) == 25
    assert float(line["sack_count"]) == 30


def test_a_line_needs_sacks_cavans_or_kilos(auth_client):
    res = auth_client.post(
        "/api/paddy/purchases",
        json={"purchase_date": "2026-10-29", "items": [{"price_per_cavan": "1200"}]},
    )
    assert res.status_code == 422
    assert "sacks, cavans or kilos" in res.text


def test_weighed_kilos_win_and_the_stock_counts_sacks_by_what_they_weighed(auth_client):
    _buy(auth_client, sack_count="10", gross_weight_kg="560")  # 56 kg a sack
    row = _stock(auth_client)
    assert row["quantity_kg"] == 560.0
    assert row["quantity_sacks"] == 10.0
    assert row["quantity_cavans"] == 11.2

    _buy(auth_client, sack_count="20", gross_weight_kg="1000")  # 50 kg a sack
    row = _stock(auth_client)
    assert row["quantity_kg"] == 1560.0
    assert row["quantity_sacks"] == 30.0


# ── wet palay ────────────────────────────────────────────────────────────────


def test_wet_palay_is_red_until_it_is_dried(auth_client, db_session):
    purchase = _buy(auth_client, sack_count="20", moisture_content_pct="24", is_wet=True)
    [line] = purchase["items"]
    assert purchase["status"] == "received"
    assert purchase["is_drying"] is True
    assert line["is_wet"] is True and line["is_drying"] is True
    assert line["dried_weight_kg"] is None
    # It's in the warehouse, so it's in stock, and the stock says how much is wet.
    row = _stock(auth_client)
    assert (row["quantity_kg"], row["wet_kg"], row["wet_sacks"], row["wet_cavans"]) == (1000.0, 1000.0, 20.0, 20.0)
    assert db_session.query(DryingRecord).count() == 0


def test_recording_the_drying_completes_the_line_and_the_stock_holds_the_dried_weight(auth_client, db_session):
    purchase = _buy(auth_client, sack_count="20", moisture_content_pct="24", is_wet=True)
    [line] = purchase["items"]

    done = _ok(
        auth_client.post(
            f"/api/paddy/purchases/{purchase['id']}/items/{line['id']}/dried",
            json={"dried_weight_kg": "800", "dried_moisture_pct": "14"},
        )
    )

    assert done["status"] == "completed"
    assert done["is_drying"] is False
    [dried] = done["items"]
    assert dried["is_drying"] is False
    assert float(dried["dried_weight_kg"]) == 800
    assert float(dried["dried_moisture_pct"]) == 14
    assert dried["dried_at"] is not None
    # Paid on the wet weight it was bought at.
    assert done["total_amount"] == 24000.0

    row = _stock(auth_client)
    assert (row["quantity_kg"], row["wet_kg"]) == (800.0, 0)
    bucket = db_session.query(PalayInventory).one()
    adjustment = (
        db_session.query(PalayInventoryMovement)
        .filter(PalayInventoryMovement.inventory_id == bucket.id, PalayInventoryMovement.movement_type == "adjustment")
        .one()
    )
    assert float(adjustment.quantity_kg) == -200
    assert float(adjustment.balance_after_kg) == 800

    # The automations that look for wet palay not yet drying see it as dried.
    record = db_session.query(DryingRecord).one()
    assert record.end_datetime is not None
    assert (float(record.initial_moisture_pct), float(record.final_moisture_pct)) == (24, 14)

    [entry] = _ok(auth_client.get(f"/api/paddy/history/palay_purchase/{purchase['id']}"))
    assert entry["detail"] == "NSIC Rc 222, 20 sacks dried: 1,000 kg → 800 kg, moisture 24% → 14%"


def test_a_purchase_is_completed_only_when_all_its_wet_lines_are_dry(auth_client):
    wet = {"variety_id": _variety(auth_client)["id"], "sack_count": "10", "price_per_cavan": "1200", "is_wet": True}
    purchase = _ok(
        auth_client.post(
            "/api/paddy/purchases",
            json={"purchase_date": "2026-10-29", "items": [wet, {**wet, "sack_count": "12"}]},
        ),
        201,
    )
    first, second = purchase["items"]
    first_done = _ok(
        auth_client.post(
            f"/api/paddy/purchases/{purchase['id']}/items/{first['id']}/dried", json={"dried_weight_kg": "450"}
        )
    )
    assert first_done["status"] == "received" and first_done["is_drying"] is True
    second_done = _ok(
        auth_client.post(
            f"/api/paddy/purchases/{purchase['id']}/items/{second['id']}/dried", json={"dried_weight_kg": "540"}
        )
    )
    assert second_done["status"] == "completed" and second_done["is_drying"] is False
    assert _stock(auth_client)["quantity_kg"] == 990.0


def test_a_wet_line_can_come_with_its_drying_already_done(auth_client, db_session):
    purchase = _buy(
        auth_client,
        sack_count="20",
        moisture_content_pct="22",
        is_wet=True,
        dried_weight_kg="850",
        dried_moisture_pct="14",
    )
    assert purchase["status"] == "completed"
    assert _stock(auth_client)["quantity_kg"] == 850.0
    assert db_session.query(DryingRecord).count() == 1


def test_drying_is_recorded_once_and_only_on_wet_lines(auth_client):
    wet = _buy(auth_client, sack_count="20", is_wet=True)
    dry = _buy(auth_client, sack_count="5")
    url = "/api/paddy/purchases/{}/items/{}/dried"
    body = {"dried_weight_kg": "900"}

    assert auth_client.post(url.format(dry["id"], dry["items"][0]["id"]), json=body).status_code == 422
    assert auth_client.post(url.format(wet["id"], "00000000-0000-0000-0000-000000000001"), json=body).status_code == 404
    _ok(auth_client.post(url.format(wet["id"], wet["items"][0]["id"]), json=body))
    again = auth_client.post(url.format(wet["id"], wet["items"][0]["id"]), json=body)
    assert again.status_code == 409
    assert (
        auth_client.post(url.format(wet["id"], wet["items"][0]["id"]), json={"dried_weight_kg": "0"}).status_code == 422
    )


def test_only_wet_palay_has_an_after_drying_weight(auth_client):
    res = auth_client.post(
        "/api/paddy/purchases",
        json={
            "purchase_date": "2026-10-29",
            "items": [{"sack_count": "5", "price_per_cavan": "1200", "dried_weight_kg": "200"}],
        },
    )
    assert res.status_code == 422


def test_correcting_a_purchase_with_dried_lines_replaces_them_and_their_drying(auth_client, db_session):
    purchase = _buy(auth_client, sack_count="20", moisture_content_pct="24", is_wet=True, dried_weight_kg="800")
    [line] = purchase["items"]
    assert db_session.query(DryingRecord).count() == 1

    edited = _ok(
        auth_client.patch(
            f"/api/paddy/purchases/{purchase['id']}",
            json={
                "weight_change_reason": "Recounted",
                "items": [
                    {
                        "variety_id": line["variety_id"],
                        "sack_count": "18",
                        "price_per_cavan": "1200",
                        "is_wet": True,
                        "moisture_content_pct": "24",
                    }
                ]
            },
        )
    )

    # Back to wet and undried: red again, the old drying record gone, stock at the wet weight.
    assert edited["status"] == "received"
    assert edited["is_drying"] is True
    assert db_session.query(DryingRecord).count() == 0
    row = _stock(auth_client)
    assert (row["quantity_kg"], row["wet_kg"]) == (900.0, 900.0)


# ── the Boss's choice of how the stock is counted ────────────────────────────


def test_the_stock_view_defaults_to_all_and_only_the_boss_changes_it(make_auth_client):
    boss = make_auth_client(["paddy"], username="boss", role_name="owner")
    assert _ok(boss.get("/api/paddy/stock-view")) == {"view": "all"}
    assert _ok(boss.put("/api/paddy/stock-view", json={"view": "sacks"})) == {"view": "sacks"}
    assert _ok(boss.get("/api/paddy/stock-view")) == {"view": "sacks"}
    assert boss.put("/api/paddy/stock-view", json={"view": "bushels"}).status_code == 422

    # Another role reads the choice but can't change it. (A new test client takes over
    # from the one before, so this is another mill's accountant and boss is not used again.)
    books = make_auth_client(["paddy"], username="books", role_name="accountant")
    assert _ok(books.get("/api/paddy/stock-view")) == {"view": "all"}
    assert books.put("/api/paddy/stock-view", json={"view": "kilos"}).status_code == 403
    assert _ok(books.get("/api/paddy/stock-view")) == {"view": "all"}
