"""Characterization: the paddy domain (Phase 2's first refactor target).

The most thorough suite, by design — it must stay byte-for-byte green through the
schema/repository/service refactor. We pin: status codes, conflict handling, the
reference-number format, the multi-item purchase transaction's effect on
inventory + movements, and the exact serialized shape of GET /paddy/inventory.
"""
import re

from app.models.paddy import PalayInventory, PalayInventoryMovement


def _make_variety(c, code="NSIC", name="NSIC Rc222"):
    return c.post("/api/paddy/varieties", json={"code": code, "name": name})


def _make_grade(c, code="A"):
    return c.post("/api/paddy/grades", json={"code": code})


def _make_supplier(c, name="Juan Farmer"):
    return c.post("/api/paddy/suppliers", json={"name": name})


# ── varieties ────────────────────────────────────────────────────────────────

def test_create_variety_201(auth_client):
    res = _make_variety(auth_client)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["code"] == "NSIC"
    assert body["name"] == "NSIC Rc222"
    assert body["is_active"] is True


def test_create_variety_duplicate_code_409(auth_client):
    _make_variety(auth_client)
    dup = _make_variety(auth_client)
    assert dup.status_code == 409
    assert "already exists" in dup.json()["detail"]


def test_list_varieties_excludes_inactive_by_default(auth_client):
    created = _make_variety(auth_client).json()
    # Deactivate it.
    upd = auth_client.put(f"/api/paddy/varieties/{created['id']}", json={"is_active": False})
    assert upd.status_code == 200
    default_list = auth_client.get("/api/paddy/varieties").json()
    assert all(v["id"] != created["id"] for v in default_list)
    incl = auth_client.get("/api/paddy/varieties", params={"include_inactive": True}).json()
    assert any(v["id"] == created["id"] for v in incl)


# ── grades ───────────────────────────────────────────────────────────────────

def test_create_grade_201(auth_client):
    res = _make_grade(auth_client)
    assert res.status_code == 201, res.text
    assert res.json()["code"] == "A"


def test_create_grade_blank_code_422(auth_client):
    res = auth_client.post("/api/paddy/grades", json={"code": "   "})
    assert res.status_code == 422


def test_create_grade_duplicate_409(auth_client):
    _make_grade(auth_client)
    assert _make_grade(auth_client).status_code == 409


# ── suppliers ────────────────────────────────────────────────────────────────

def test_create_supplier_201_assigns_canva_color(auth_client):
    res = _make_supplier(auth_client)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "Juan Farmer"
    # color is system-assigned, never from the client
    assert body["canva_color_hex"]


# ── purchases (the transactional core) ───────────────────────────────────────

def test_create_purchase_multi_item_updates_inventory(auth_client, db_session):
    variety = _make_variety(auth_client).json()
    grade = _make_grade(auth_client).json()
    supplier = _make_supplier(auth_client).json()

    payload = {
        "supplier_id": supplier["id"],
        "purchase_date": "2026-06-05",
        "items": [
            # net = gross - tare
            {"variety_id": variety["id"], "grade_id": grade["id"],
             "gross_weight_kg": "1000", "tare_weight_kg": "50", "price_per_cavan": "1200"},
            {"variety_id": variety["id"], "grade_id": grade["id"],
             "gross_weight_kg": "500", "tare_weight_kg": "0", "price_per_cavan": "1200"},
        ],
    }
    res = auth_client.post("/api/paddy/purchases", json=payload)
    assert res.status_code == 201, res.text
    purchase = res.json()

    # reference number format: PP-YYYYMMDD-NNNN
    assert re.match(r"^PP-\d{8}-\d{4}$", purchase["reference_no"]), purchase["reference_no"]
    assert purchase["status"] == "received"

    # Both items land on ONE inventory bucket (same variety+grade+branch):
    # net = (1000-50) + (500-0) = 1450
    inv_rows = (
        db_session.query(PalayInventory)
        .filter(PalayInventory.variety_id == variety["id"])
        .all()
    )
    assert len(inv_rows) == 1
    assert float(inv_rows[0].quantity_kg) == 1450.0

    movements = (
        db_session.query(PalayInventoryMovement)
        .filter(PalayInventoryMovement.inventory_id == inv_rows[0].id)
        .all()
    )
    assert len(movements) == 2
    assert all(m.movement_type == "in" and m.source_type == "purchase" for m in movements)


def test_purchase_is_atomic_on_item_failure(auth_client, db_session):
    """A failure on a later item must roll back the whole purchase (incl. the
    first item's inventory write). Guards the transaction-ownership move."""
    variety = _make_variety(auth_client).json()
    grade = _make_grade(auth_client).json()
    supplier = _make_supplier(auth_client).json()

    bad_variety = "00000000-0000-0000-0000-000000000000"  # not a real FK
    payload = {
        "supplier_id": supplier["id"],
        "purchase_date": "2026-06-05",
        "items": [
            {"variety_id": variety["id"], "grade_id": grade["id"],
             "gross_weight_kg": "1000", "tare_weight_kg": "0", "price_per_cavan": "1200"},
            {"variety_id": bad_variety, "grade_id": grade["id"],
             "gross_weight_kg": "500", "tare_weight_kg": "0", "price_per_cavan": "1200"},
        ],
    }
    # The unknown variety is caught by the tenant-FK guard (security hardening)
    # and returns a clean 404 BEFORE any write — previously this surfaced as a
    # DB FK violation / server error that the TestClient re-raised.
    res = auth_client.post("/api/paddy/purchases", json=payload)
    assert res.status_code == 404

    # All-or-nothing: the first item's inventory must NOT have been persisted.
    db_session.rollback()  # clear any failed savepoint before re-querying
    leftover = (
        db_session.query(PalayInventory)
        .filter(PalayInventory.variety_id == variety["id"])
        .all()
    )
    assert leftover == []


def test_get_paddy_inventory_serialized_shape(auth_client):
    """Pin the exact dict shape the frontend consumes (Phase 2 must preserve)."""
    variety = _make_variety(auth_client).json()
    grade = _make_grade(auth_client).json()
    supplier = _make_supplier(auth_client).json()
    auth_client.post("/api/paddy/purchases", json={
        "supplier_id": supplier["id"],
        "purchase_date": "2026-06-05",
        "items": [{"variety_id": variety["id"], "grade_id": grade["id"],
                   "gross_weight_kg": "200", "tare_weight_kg": "0", "price_per_cavan": "1000"}],
    })

    rows = auth_client.get("/api/paddy/inventory").json()
    assert len(rows) == 1
    row = rows[0]
    assert set(row.keys()) == {"id", "branch_id", "branch", "variety", "grade", "quantity_kg"}
    assert row["quantity_kg"] == 200.0
    assert set(row["variety"].keys()) == {"id", "code", "name"}
    assert set(row["grade"].keys()) == {"id", "code"}
    assert set(row["branch"].keys()) == {"id", "name", "is_main_branch"}
