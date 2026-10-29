"""Characterization: the paddy domain (Phase 2's first refactor target).

The most thorough suite, by design — it must stay byte-for-byte green through the
schema/repository/service refactor. We pin: status codes, conflict handling, the
reference-number format, the multi-item purchase transaction's effect on
inventory + movements, and the exact serialized shape of GET /paddy/inventory.
"""

import re
import uuid

from app.models.company import Branch
from app.models.paddy import PalayInventory, PalayInventoryMovement, PalayPurchase
from app.models.user import User


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


def _standard(c, code="Dinorado"):
    every = c.get("/api/paddy/varieties", params={"include_inactive": True}).json()
    return next(v for v in every if v["code"] == code and v["company_id"] is None)


def test_a_new_mill_starts_with_the_default_varieties(auth_client):
    every = auth_client.get("/api/paddy/varieties", params={"include_inactive": True}).json()
    assert sorted(v["code"] for v in every if v["company_id"] is None and v["kind"] == "rice") == sorted(
        [
            "Black Rice",
            "Brown Rice",
            "Dinorado",
            "Jasmine Rice",
            "Maharlika",
            "Malagkit",
            "Red Rice",
            "Sinandomeng",
        ]
    )
    malagkit = _standard(auth_client, "Malagkit")
    assert malagkit["name"] == "Malagkit (Glutinous Rice | Sticky Rice)"


def test_a_new_mill_starts_with_the_palay_varieties_and_what_they_are_also_known_as(auth_client):
    every = auth_client.get("/api/paddy/varieties", params={"include_inactive": True}).json()
    palay = {v["code"]: v for v in every if v["company_id"] is None and v["kind"] == "palay"}
    assert len(palay) == 33
    assert sum(v["category"] == "inbred" for v in palay.values()) == 27
    assert sum(v["category"] == "hybrid" for v in palay.values()) == 6
    assert palay["NSIC Rc 222"]["name"] == "NSIC Rc 222 (Tubigan 18, Triple Two)"
    assert palay["NSIC Rc 218 SR"]["name"] == "NSIC Rc 218 SR (Mabango 3)"
    assert palay["PSB Rc 72H"]["name"] == "PSB Rc 72H (Mestiso 1)"
    assert palay["Longping 2096"]["name"] == "Longping 2096 (LP 2096)"
    assert palay["NSIC Rc 302"]["name"] == "NSIC Rc 302"
    assert not any(code in palay for code in ("Dinorado", "Malagkit"))


def test_a_variety_joins_the_list_of_the_page_that_made_it(auth_client):
    made = auth_client.post("/api/paddy/varieties", json={"code": "Tubigan 99", "name": "Mine", "kind": "palay"})
    assert made.status_code == 201, made.text
    assert made.json()["kind"] == "palay"
    assert _make_variety(auth_client, "Plain", "Plain").json()["kind"] == "rice"
    bad = auth_client.post("/api/paddy/varieties", json={"code": "X", "name": "X", "kind": "both"})
    assert bad.status_code == 422


def test_a_palay_and_a_rice_variety_may_share_a_code_but_not_on_one_page(auth_client):
    assert (
        auth_client.post("/api/paddy/varieties", json={"code": "Same", "name": "A", "kind": "palay"}).status_code == 201
    )
    assert (
        auth_client.post("/api/paddy/varieties", json={"code": "same", "name": "B", "kind": "rice"}).status_code == 201
    )
    again = auth_client.post("/api/paddy/varieties", json={"code": "SAME", "name": "C", "kind": "palay"})
    assert again.status_code == 409


def test_a_standard_variety_can_be_edited(auth_client):
    dinorado = _standard(auth_client)
    res = auth_client.put(
        f"/api/paddy/varieties/{dinorado['id']}",
        json={"name": "Dinorado (Premium)", "category": "local", "typical_recovery_pct": "67.5"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "Dinorado (Premium)"
    assert float(body["typical_recovery_pct"]) == 67.5


def test_a_standard_variety_can_be_hidden_and_unhidden(auth_client):
    dinorado = _standard(auth_client)
    url = f"/api/paddy/varieties/{dinorado['id']}"
    assert auth_client.put(url, json={"is_active": False}).status_code == 200
    assert all(v["id"] != dinorado["id"] for v in auth_client.get("/api/paddy/varieties").json())

    assert auth_client.put(url, json={"is_active": True}).status_code == 200
    assert any(v["id"] == dinorado["id"] for v in auth_client.get("/api/paddy/varieties").json())
    assert _standard(auth_client)["deactivated_at"] is None


def test_a_code_is_taken_whatever_its_case(auth_client):
    assert _make_variety(auth_client, code="dinorado").status_code == 409
    mine = _make_variety(auth_client, code="RC400", name="NSIC Rc400").json()
    clash = auth_client.put(f"/api/paddy/varieties/{mine['id']}", json={"code": "RED RICE"})
    assert clash.status_code == 409


def test_a_variety_needs_a_name(auth_client):
    mine = _make_variety(auth_client).json()
    res = auth_client.put(f"/api/paddy/varieties/{mine['id']}", json={"name": "  "})
    assert res.status_code == 422


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
            {
                "variety_id": variety["id"],
                "grade_id": grade["id"],
                "gross_weight_kg": "1000",
                "tare_weight_kg": "50",
                "price_per_cavan": "1200",
            },
            {
                "variety_id": variety["id"],
                "grade_id": grade["id"],
                "gross_weight_kg": "500",
                "tare_weight_kg": "0",
                "price_per_cavan": "1200",
            },
        ],
    }
    res = auth_client.post("/api/paddy/purchases", json=payload)
    assert res.status_code == 201, res.text
    purchase = res.json()

    # reference number format: PP-YYYYMMDD-NNNN
    assert re.match(r"^PP-\d{8}-\d{4}$", purchase["reference_no"]), purchase["reference_no"]
    assert purchase["status"] == "completed"  # bought dry: nothing left to do

    # Both items land on ONE inventory bucket (same variety+grade+branch):
    # net = (1000-50) + (500-0) = 1450
    inv_rows = db_session.query(PalayInventory).filter(PalayInventory.variety_id == variety["id"]).all()
    assert len(inv_rows) == 1
    assert float(inv_rows[0].quantity_kg) == 1450.0

    movements = (
        db_session.query(PalayInventoryMovement).filter(PalayInventoryMovement.inventory_id == inv_rows[0].id).all()
    )
    assert len(movements) == 2
    assert all(m.movement_type == "in" and m.source_type == "purchase" for m in movements)


def test_purchase_list_says_who_recorded_it(auth_client):
    supplier = _make_supplier(auth_client).json()
    item = {"gross_weight_kg": "100", "tare_weight_kg": "0", "price_per_cavan": "1000"}
    created = auth_client.post(
        "/api/paddy/purchases",
        json={"supplier_id": supplier["id"], "purchase_date": "2026-06-05", "items": [item, item]},
    )
    assert created.status_code == 201, created.text

    rows = auth_client.get("/api/paddy/purchases").json()
    assert len(rows) == 1
    # The list carries the supplier and the item count the table shows.
    assert rows[0]["supplier"] == {"id": supplier["id"], "name": supplier["name"]}
    assert rows[0]["item_count"] == 2
    # The seeded owner is the Boss; the role name is what the web app turns into a label.
    assert rows[0]["created_by_name"] == "Test Owner"
    assert rows[0]["created_by_role"] == "owner"

    one = auth_client.get(f"/api/paddy/purchases/{rows[0]['id']}").json()
    assert one["created_by_name"] == "Test Owner"
    assert one["created_by_role"] == "owner"


# ── purchases: which warehouse the palay is stored in ────────────────────────

_ITEM = {"gross_weight_kg": "1000", "tare_weight_kg": "0", "price_per_cavan": "1200"}


def _second_warehouse(db_session, company_id, name="2nd Branch"):
    branch = Branch(company_id=company_id, name=name, is_main_branch=False)
    db_session.add(branch)
    db_session.flush()
    return branch


def test_purchase_goes_to_the_warehouse_the_owner_picks(auth_client, db_session, seed_owner):
    second = _second_warehouse(db_session, seed_owner.company_id)
    variety = _make_variety(auth_client).json()
    res = auth_client.post(
        "/api/paddy/purchases",
        json={
            "purchase_date": "2026-10-17",
            "branch_id": str(second.id),
            "items": [{**_ITEM, "variety_id": variety["id"]}],
        },
    )
    assert res.status_code == 201, res.text
    purchase = db_session.get(PalayPurchase, uuid.UUID(res.json()["id"]))
    assert purchase.branch_id == second.id
    stock = db_session.query(PalayInventory).filter(PalayInventory.variety_id == variety["id"]).one()
    assert stock.branch_id == second.id
    assert float(stock.quantity_kg) == 1000.0


def test_purchase_without_a_warehouse_goes_to_the_recorders_own(auth_client, db_session, seed_owner):
    _second_warehouse(db_session, seed_owner.company_id)
    variety = _make_variety(auth_client).json()
    res = auth_client.post(
        "/api/paddy/purchases",
        json={"purchase_date": "2026-10-17", "items": [{**_ITEM, "variety_id": variety["id"]}]},
    )
    assert res.status_code == 201, res.text
    stock = db_session.query(PalayInventory).filter(PalayInventory.variety_id == variety["id"]).one()
    assert stock.branch_id == seed_owner.branch_id


def test_purchase_into_an_unknown_or_trashed_warehouse_is_refused(auth_client, db_session, seed_owner):
    from datetime import datetime, timezone

    trashed = _second_warehouse(db_session, seed_owner.company_id, name="Old shed")
    trashed.deleted_at = datetime.now(timezone.utc)
    db_session.flush()
    for branch_id in (str(uuid.uuid4()), str(trashed.id)):
        res = auth_client.post(
            "/api/paddy/purchases",
            json={"purchase_date": "2026-10-17", "branch_id": branch_id, "items": [_ITEM]},
        )
        assert res.status_code == 404, res.text
        assert res.json()["detail"] == "Branch not found."
    # Refused before anything is written.
    assert db_session.query(PalayPurchase).count() == 0


def test_only_an_owner_or_admin_picks_another_warehouse(make_auth_client, db_session):
    """An encoder may record purchases, but they land in the encoder's own warehouse."""
    client = make_auth_client(features=["paddy", "inventory"], username="enc", role_name="encoder")
    encoder = db_session.query(User).filter(User.username == "enc1").one()
    second = _second_warehouse(db_session, encoder.company_id)

    refused = client.post(
        "/api/paddy/purchases",
        json={"purchase_date": "2026-10-17", "branch_id": str(second.id), "items": [_ITEM]},
    )
    assert refused.status_code == 403, refused.text
    assert "another branch" in refused.json()["detail"]

    # Naming their own warehouse is fine.
    own = client.post(
        "/api/paddy/purchases",
        json={"purchase_date": "2026-10-17", "branch_id": str(encoder.branch_id), "items": [_ITEM]},
    )
    assert own.status_code == 201, own.text


def test_purchase_detail_carries_its_lines_and_what_they_come_to(auth_client):
    variety = _make_variety(auth_client).json()
    grade = _make_grade(auth_client).json()
    res = auth_client.post(
        "/api/paddy/purchases",
        json={
            "purchase_date": "2026-10-17",
            "items": [
                {
                    "variety_id": variety["id"],
                    "grade_id": grade["id"],
                    "gross_weight_kg": "1050",
                    "tare_weight_kg": "50",
                    "moisture_content_pct": "14",
                    "price_per_cavan": "1200",
                }
            ],
        },
    )
    assert res.status_code == 201, res.text
    row = auth_client.get("/api/paddy/purchases").json()[0]
    assert row["branch"]["name"] == "Main Branch"
    assert row["total_kg"] == 1000.0
    assert row["total_amount"] == 24000.0  # 1000 kg = 20 cavans x 1,200
    [line] = row["items"]
    assert line["variety_code"] == "NSIC"
    assert line["grade_code"] == "A"
    assert float(line["net_weight_kg"]) == 1000.0
    assert float(line["moisture_content_pct"]) == 14.0


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
            {
                "variety_id": variety["id"],
                "grade_id": grade["id"],
                "gross_weight_kg": "1000",
                "tare_weight_kg": "0",
                "price_per_cavan": "1200",
            },
            {
                "variety_id": bad_variety,
                "grade_id": grade["id"],
                "gross_weight_kg": "500",
                "tare_weight_kg": "0",
                "price_per_cavan": "1200",
            },
        ],
    }
    # The unknown variety is caught by the tenant-FK guard (security hardening)
    # and returns a clean 404 BEFORE any write — previously this surfaced as a
    # DB FK violation / server error that the TestClient re-raised.
    res = auth_client.post("/api/paddy/purchases", json=payload)
    assert res.status_code == 404

    # All-or-nothing: the first item's inventory must NOT have been persisted.
    db_session.rollback()  # clear any failed savepoint before re-querying
    leftover = db_session.query(PalayInventory).filter(PalayInventory.variety_id == variety["id"]).all()
    assert leftover == []


def test_get_paddy_inventory_serialized_shape(auth_client):
    """Pin the exact dict shape the frontend consumes (Phase 2 must preserve)."""
    variety = _make_variety(auth_client).json()
    grade = _make_grade(auth_client).json()
    supplier = _make_supplier(auth_client).json()
    auth_client.post(
        "/api/paddy/purchases",
        json={
            "supplier_id": supplier["id"],
            "purchase_date": "2026-06-05",
            "items": [
                {
                    "variety_id": variety["id"],
                    "grade_id": grade["id"],
                    "gross_weight_kg": "200",
                    "tare_weight_kg": "0",
                    "price_per_cavan": "1000",
                }
            ],
        },
    )

    rows = auth_client.get("/api/paddy/inventory").json()
    assert len(rows) == 1
    row = rows[0]
    assert set(row.keys()) == {
        "id",
        "branch_id",
        "branch",
        "warehouse_id",
        "warehouse",
        "variety",
        "grade",
        "quantity_kg",
        "quantity_cavans",
        "quantity_sacks",
        "wet_kg",
        "wet_cavans",
        "wet_sacks",
    }
    assert row["quantity_kg"] == 200.0
    assert row["quantity_cavans"] == 4.0
    assert row["quantity_sacks"] == 4.0  # no sacks counted: a sack is taken as 50 kg
    assert row["wet_kg"] == 0
    assert set(row["variety"].keys()) == {"id", "code", "name"}
    assert set(row["grade"].keys()) == {"id", "code"}
    assert set(row["branch"].keys()) == {"id", "name", "is_main_branch"}
