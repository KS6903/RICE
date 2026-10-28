"""Edit power reaches purchases and expenses: someone with it corrects a saved
palay, rice or by-product purchase, or an expense; stock follows a purchase's
corrected lines; and every change is logged, field by field, in that record's
history. (Sales records: test_sales_edits.py.)"""

from __future__ import annotations

from app.models.milling import ByproductInventory, MilledRiceInventory
from app.models.paddy import PalayInventory
from app.models.reference import ByproductKind


def _ok(res, code=200):
    assert res.status_code == code, res.text
    return res.json()


def _history(c, base, kind, record_id):
    return _ok(c.get(f"/api/{base}/history/{kind}/{record_id}"))


def _supplier(c, name):
    return _ok(c.post("/api/paddy/suppliers", json={"name": name}), 201)


def _variety(c, code="RC400"):
    return _ok(c.post("/api/paddy/varieties", json={"code": code, "name": f"NSIC {code}"}), 201)


# ── palay ────────────────────────────────────────────────────────────────────


def test_a_palay_purchase_is_corrected_and_its_stock_follows(auth_client, db_session):
    variety = _variety(auth_client)
    first, second = _supplier(auth_client, "Mang Ben"), _supplier(auth_client, "Aling Rosa")
    line = {"variety_id": variety["id"], "gross_weight_kg": "1000", "tare_weight_kg": "50", "price_per_cavan": "1200"}
    purchase = _ok(
        auth_client.post(
            "/api/paddy/purchases",
            json={"supplier_id": first["id"], "purchase_date": "2026-10-20", "items": [line]},
        ),
        201,
    )

    edited = _ok(
        auth_client.patch(
            f"/api/paddy/purchases/{purchase['id']}",
            json={
                "supplier_id": second["id"],
                "items": [{**line, "gross_weight_kg": "1200", "moisture_content_pct": "14"}],
            },
        )
    )
    assert edited["supplier"]["name"] == "Aling Rosa"
    assert edited["total_kg"] == 1150.0

    stock = db_session.query(PalayInventory).filter(PalayInventory.variety_id == variety["id"]).one()
    assert float(stock.quantity_kg) == 1150.0

    [entry] = _history(auth_client, "paddy", "palay_purchase", purchase["id"])
    assert entry["detail"].splitlines() == [
        "Supplier: Mang Ben → Aling Rosa",
        "Lines: RC400, 1,000 kg gross, 50 kg tare, ₱1,200/cavan"
        " → RC400, 1,200 kg gross, 50 kg tare, 14% moisture, ₱1,200/cavan",
    ]


def test_saving_a_purchase_unchanged_logs_nothing(auth_client):
    item = {"gross_weight_kg": "100", "price_per_cavan": "1000"}
    purchase = _ok(auth_client.post("/api/paddy/purchases", json={"purchase_date": "2026-10-20", "items": [item]}), 201)
    _ok(auth_client.patch(f"/api/paddy/purchases/{purchase['id']}", json={"purchase_date": "2026-10-20"}))
    assert _history(auth_client, "paddy", "palay_purchase", purchase["id"]) == []
    res = auth_client.patch(f"/api/paddy/purchases/{purchase['id']}", json={"purchase_date": None})
    assert res.status_code == 422


# ── rice and by-products ─────────────────────────────────────────────────────


def test_a_rice_purchase_moves_its_stock_to_the_corrected_grade(auth_client, db_session):
    variety = _variety(auth_client)
    line = {"variety_id": variety["id"], "grade_name": "Graded Rice", "sack_count": "20", "price_per_sack": "2400"}
    purchase = _ok(
        auth_client.post("/api/paddy/rice-purchases", json={"purchase_date": "2026-10-20", "items": [line]}), 201
    )

    edited = _ok(
        auth_client.patch(
            f"/api/paddy/rice-purchases/{purchase['id']}",
            json={
                "items": [{**line, "grade_name": "Straight Mill Rice", "sack_count": "18"}],
                "remarks": "Wrong grade",
            },
        )
    )
    assert edited["total_kg"] == 900.0
    stock = {r.grade_name: float(r.quantity_kg) for r in db_session.query(MilledRiceInventory).all()}
    assert stock == {"Graded Rice": 0.0, "Straight Mill Rice": 900.0}

    [entry] = _history(auth_client, "paddy", "rice_purchase", purchase["id"])
    assert entry["detail"].splitlines() == [
        "Remarks: blank → Wrong grade",
        "Lines: RC400 Graded Rice, 20 sacks of 50 kg at ₱2,400/sack"
        " → RC400 Straight Mill Rice, 18 sacks of 50 kg at ₱2,400/sack",
    ]


def test_a_byproduct_purchase_corrected_to_another_byproduct(auth_client, db_session):
    line = {"byproduct_type": "darak", "weight_kg": "500", "price_per_kg": "14"}
    purchase = _ok(
        auth_client.post("/api/paddy/byproduct-purchases", json={"purchase_date": "2026-10-20", "items": [line]}),
        201,
    )

    _ok(
        auth_client.patch(
            f"/api/paddy/byproduct-purchases/{purchase['id']}",
            json={"items": [{**line, "byproduct_type": "Darak_D1", "weight_kg": "450"}]},
        )
    )
    stock = {r.byproduct_type: float(r.quantity_kg) for r in db_session.query(ByproductInventory).all()}
    assert stock == {"darak": 0.0, "darak_d1": 450.0}
    assert [k.code for k in db_session.query(ByproductKind).all()] == ["darak_d1"]

    [entry] = _history(auth_client, "paddy", "byproduct_purchase", purchase["id"])
    assert entry["detail"] == "Lines: Darak (Rice Bran), 500 kg at ₱14/kg → Darak d1, 450 kg at ₱14/kg"


# ── expenses ─────────────────────────────────────────────────────────────────


def test_an_expense_is_corrected_and_logged(auth_client):
    categories = {c["name"]: c["id"] for c in _ok(auth_client.get("/api/costs/categories"))}
    expense = _ok(
        auth_client.post(
            "/api/costs/expenses",
            json={"category_id": categories["Fuel"], "expense_date": "2026-10-20", "amount": "1500"},
        ),
        201,
    )

    edited = _ok(
        auth_client.patch(
            f"/api/costs/expenses/{expense['id']}",
            json={"category_id": categories["Electricity"], "amount": "1850.50", "description": "Meralco"},
        )
    )
    assert float(edited["amount"]) == 1850.5

    [entry] = _history(auth_client, "costs", "expense", expense["id"])
    assert entry["entity_label"] == "Electricity on 2026-10-20"
    assert entry["detail"].splitlines() == [
        "Category: Fuel → Electricity",
        "Amount: 1,500 → 1,850.50",
        "Description: blank → Meralco",
    ]
    for required in ("category_id", "expense_date", "amount"):
        res = auth_client.patch(f"/api/costs/expenses/{expense['id']}", json={required: None})
        assert res.status_code == 422, required


# ── who may ──────────────────────────────────────────────────────────────────


def test_without_edit_power_purchases_and_expenses_stay_as_saved(make_auth_client):
    # The accountant sees the Buy pages and runs Expenses, but has no edit power.
    accountant = make_auth_client(["paddy", "expenses"], username="books", role_name="accountant")
    some_id = "00000000-0000-0000-0000-000000000001"
    for url in (
        f"/api/paddy/purchases/{some_id}",
        f"/api/paddy/rice-purchases/{some_id}",
        f"/api/paddy/byproduct-purchases/{some_id}",
        f"/api/costs/expenses/{some_id}",
    ):
        res = accountant.patch(url, json={"remarks": "x"})
        assert res.status_code == 403, url
        assert "edit power" in res.json()["detail"]


def test_another_mills_purchase_cannot_be_corrected(make_auth_client):
    theirs = make_auth_client(["paddy"], username="theirs")
    line = {"byproduct_type": "ipa", "weight_kg": "100", "price_per_kg": "2"}
    purchase = _ok(
        theirs.post("/api/paddy/byproduct-purchases", json={"purchase_date": "2026-10-20", "items": [line]}), 201
    )
    mine = make_auth_client(["paddy"], username="mine")
    res = mine.patch(f"/api/paddy/byproduct-purchases/{purchase['id']}", json={"remarks": "mine"})
    assert res.status_code == 404
    assert _history(mine, "paddy", "byproduct_purchase", purchase["id"]) == []
