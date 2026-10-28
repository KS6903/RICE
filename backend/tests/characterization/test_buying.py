"""Rice (bigas) and by-product purchases: the palay purchase, for what else a mill buys.

Pins: a purchase lands in stock (the same milled-rice / by-product rows milling and
Add inventory use), in the warehouse picked; the list says what was bought, where
and by whom; lines that make no sense are refused before anything is written.
"""

import re

from app.models.company import Branch
from app.models.milling import ByproductInventory, MilledRiceInventory


def _variety(c, code="RC400"):
    res = c.post("/api/paddy/varieties", json={"code": code, "name": f"NSIC {code}"})
    assert res.status_code == 201, res.text
    return res.json()


def _rice_line(variety_id, **over):
    return {
        "variety_id": variety_id,
        "grade_name": "Graded Rice",
        "sack_count": "20",
        "kg_per_sack": "50",
        "price_per_sack": "2400",
        **over,
    }


# ── rice ─────────────────────────────────────────────────────────────────────


def test_rice_purchase_adds_its_sacks_to_milled_rice_stock(auth_client, db_session, seed_owner):
    variety = _variety(auth_client)
    res = auth_client.post(
        "/api/paddy/rice-purchases",
        json={
            "purchase_date": "2026-10-17",
            "delivery_type": "delivered",
            "items": [
                _rice_line(variety["id"]),
                # Same variety and grade in 25 kg sacks: the same stock row.
                _rice_line(variety["id"], sack_count="10", kg_per_sack="25", price_per_sack="1250"),
            ],
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert re.match(r"^RP-\d{8}-\d{4}$", body["reference_no"]), body["reference_no"]
    assert body["status"] == "received"
    assert body["item_count"] == 2
    assert body["total_kg"] == 20 * 50 + 10 * 25
    assert body["total_amount"] == 20 * 2400 + 10 * 1250
    assert body["branch"]["name"] == "Main Branch"
    assert body["created_by_role"] == "owner"

    stock = db_session.query(MilledRiceInventory).filter(MilledRiceInventory.variety_id == variety["id"]).all()
    assert len(stock) == 1
    assert stock[0].grade_name == "Graded Rice"
    assert stock[0].branch_id == seed_owner.branch_id
    assert float(stock[0].quantity_kg) == 1250.0

    # The Rice page's stock table reads it back.
    rows = auth_client.get("/api/paddy/rice-stock").json()
    assert [(r["variety"]["code"], r["grade_name"], r["quantity_kg"]) for r in rows] == [
        ("RC400", "Graded Rice", 1250.0)
    ]


def test_rice_purchase_goes_to_the_warehouse_the_owner_picks(auth_client, db_session, seed_owner):
    second = Branch(company_id=seed_owner.company_id, name="2nd Branch")
    db_session.add(second)
    db_session.flush()
    variety = _variety(auth_client)
    res = auth_client.post(
        "/api/paddy/rice-purchases",
        json={"purchase_date": "2026-10-17", "branch_id": str(second.id), "items": [_rice_line(variety["id"])]},
    )
    assert res.status_code == 201, res.text
    assert res.json()["branch"]["name"] == "2nd Branch"
    stock = db_session.query(MilledRiceInventory).filter(MilledRiceInventory.variety_id == variety["id"]).one()
    assert stock.branch_id == second.id


def test_rice_purchases_list_newest_first_with_who_recorded_them(auth_client):
    variety = _variety(auth_client)
    for day in ("2026-10-01", "2026-10-15"):
        assert (
            auth_client.post(
                "/api/paddy/rice-purchases",
                json={"purchase_date": day, "items": [_rice_line(variety["id"])]},
            ).status_code
            == 201
        )
    rows = auth_client.get("/api/paddy/rice-purchases").json()
    assert [r["purchase_date"] for r in rows] == ["2026-10-15", "2026-10-01"]
    assert rows[0]["created_by_name"] == "Test Owner"
    # Each carries its lines, for the detail popup.
    [line] = rows[0]["items"]
    assert line["variety_code"] == "RC400"
    assert float(line["sack_count"]) == 20.0
    assert float(line["weight_kg"]) == 1000.0
    assert float(line["line_total"]) == 48000.0


def test_rice_lines_that_make_no_sense_are_refused(auth_client):
    variety = _variety(auth_client)
    for bad in (
        {"items": []},
        {"items": [_rice_line(variety["id"], sack_count="0")]},
        {"items": [_rice_line(variety["id"], kg_per_sack="-5")]},
        {"items": [_rice_line(variety["id"], price_per_sack="-1")]},
    ):
        res = auth_client.post("/api/paddy/rice-purchases", json={"purchase_date": "2026-10-17", **bad})
        assert res.status_code == 422, (bad, res.text)
    assert auth_client.get("/api/paddy/rice-purchases").json() == []


def test_rice_purchase_with_an_unknown_variety_is_refused_before_writing(auth_client, db_session):
    res = auth_client.post(
        "/api/paddy/rice-purchases",
        json={"purchase_date": "2026-10-17", "items": [_rice_line("00000000-0000-0000-0000-000000000000")]},
    )
    assert res.status_code == 404
    assert db_session.query(MilledRiceInventory).count() == 0


# ── by-products ──────────────────────────────────────────────────────────────


def test_byproduct_purchase_adds_its_weight_to_byproduct_stock(auth_client, db_session, seed_owner):
    res = auth_client.post(
        "/api/paddy/byproduct-purchases",
        json={
            "purchase_date": "2026-10-17",
            "items": [
                {"byproduct_type": "darak", "weight_kg": "500", "price_per_kg": "14"},
                {"byproduct_type": " Darak ", "weight_kg": "250", "price_per_kg": "14"},
                {"byproduct_type": "ipa", "weight_kg": "1000", "price_per_kg": "2"},
            ],
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert re.match(r"^BP-\d{8}-\d{4}$", body["reference_no"]), body["reference_no"]
    assert body["item_count"] == 3
    assert body["total_kg"] == 1750
    assert body["total_amount"] == 750 * 14 + 1000 * 2

    stock = {r.byproduct_type: float(r.quantity_kg) for r in db_session.query(ByproductInventory).all()}
    assert stock == {"darak": 750.0, "ipa": 1000.0}
    assert all(r.branch_id == seed_owner.branch_id for r in db_session.query(ByproductInventory).all())

    rows = auth_client.get("/api/paddy/byproduct-stock").json()
    assert sorted((r["byproduct_type"], r["quantity_kg"]) for r in rows) == [("darak", 750.0), ("ipa", 1000.0)]
    listed = auth_client.get("/api/paddy/byproduct-purchases").json()
    assert [r["reference_no"] for r in listed] == [body["reference_no"]]


def test_byproduct_lines_that_make_no_sense_are_refused(auth_client):
    for line in (
        {"byproduct_type": "  ", "weight_kg": "10", "price_per_kg": "1"},
        {"byproduct_type": "ipa", "weight_kg": "0", "price_per_kg": "1"},
        {"byproduct_type": "ipa", "weight_kg": "10", "price_per_kg": "-1"},
    ):
        res = auth_client.post("/api/paddy/byproduct-purchases", json={"purchase_date": "2026-10-17", "items": [line]})
        assert res.status_code == 422, (line, res.text)


def test_only_an_owner_or_admin_stores_rice_or_byproducts_in_another_warehouse(make_auth_client, db_session):
    from app.models.user import User

    client = make_auth_client(features=["paddy", "inventory"], username="enc", role_name="encoder")
    encoder = db_session.query(User).filter(User.username == "enc1").one()
    second = Branch(company_id=encoder.company_id, name="2nd Branch")
    db_session.add(second)
    db_session.flush()

    rice = client.post(
        "/api/paddy/rice-purchases",
        json={
            "purchase_date": "2026-10-17",
            "branch_id": str(second.id),
            "items": [{"sack_count": "1", "price_per_sack": "2400"}],
        },
    )
    assert rice.status_code == 403, rice.text
    byproduct = client.post(
        "/api/paddy/byproduct-purchases",
        json={
            "purchase_date": "2026-10-17",
            "branch_id": str(second.id),
            "items": [{"byproduct_type": "ipa", "weight_kg": "10", "price_per_kg": "2"}],
        },
    )
    assert byproduct.status_code == 403, byproduct.text

    # In their own warehouse it's recorded.
    own = client.post(
        "/api/paddy/byproduct-purchases",
        json={
            "purchase_date": "2026-10-17",
            "items": [{"byproduct_type": "ipa", "weight_kg": "10", "price_per_kg": "2"}],
        },
    )
    assert own.status_code == 201, own.text
