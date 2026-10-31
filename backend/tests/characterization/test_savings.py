"""The Savings work over HTTP: sales move stock, cancelling puts it back, deductions
and vale come off a farmer's pay, weights lock, held stock can't be sold, FIFO holds,
and the page's figures stay the Boss's."""

from __future__ import annotations

from decimal import Decimal

from app.models.milling import ByproductInventory, MilledRiceInventory, StockMovement
from app.models.warehouse import Pallet, RiceBatch

STAFF = "cashier"


def _ok(res, status=200):
    assert res.status_code == status, res.text
    return res.json()


def _variety(client, code="SV1", kind="rice"):
    return _ok(client.post("/api/paddy/varieties", json={"code": code, "name": code, "kind": kind}), 201)


def _customer(client):
    return _ok(client.post("/api/sales/customers", json={"name": "Buyer"}), 201)


def _supplier(client, name="Mang Ben"):
    return _ok(client.post("/api/paddy/suppliers", json={"name": name}), 201)


def _branch_id(client):
    return _ok(client.get("/api/auth/me"))["branch_id"]


def _sale(client, customer, **line):
    return client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-10-20",
            "items": [{"quantity_kg": "100", "unit_price_per_kg": "45", **line}],
        },
    )


def _stock(db_session, branch_id, variety_id, kg):
    db_session.add(
        MilledRiceInventory(
            company_id=_company_of(db_session, branch_id),
            branch_id=branch_id,
            variety_id=variety_id,
            grade_name="Straight Mill Rice",
            quantity_kg=Decimal(kg),
        )
    )
    db_session.flush()


def _company_of(db_session, branch_id):
    from app.models.company import Branch

    return db_session.get(Branch, branch_id).company_id


def test_a_sale_takes_its_stock_and_cancelling_puts_it_back(auth_client, db_session):
    variety, customer = _variety(auth_client), _customer(auth_client)
    branch = _branch_id(auth_client)
    _stock(db_session, branch, variety["id"], "500")

    order = _ok(_sale(auth_client, customer, item_type="milled_rice", variety_id=variety["id"]), 201)
    row = db_session.query(MilledRiceInventory).filter_by(variety_id=variety["id"]).one()
    db_session.refresh(row)
    assert row.quantity_kg == Decimal("400")
    [move] = db_session.query(StockMovement).filter_by(source_id=order["id"]).all()
    assert move.delta_kg == Decimal("-100")
    assert move.balance_after_kg == Decimal("400")

    _ok(auth_client.put(f"/api/sales/orders/{order['id']}", json={"status": "cancelled"}))
    db_session.refresh(row)
    assert row.quantity_kg == Decimal("500")


def test_a_corrected_order_moves_stock_as_corrected(auth_client, db_session):
    variety, customer = _variety(auth_client), _customer(auth_client)
    _stock(db_session, _branch_id(auth_client), variety["id"], "500")
    line = {"item_type": "milled_rice", "variety_id": variety["id"], "unit_price_per_kg": "45"}
    order = _ok(_sale(auth_client, customer, **line), 201)

    _ok(auth_client.patch(f"/api/sales/orders/{order['id']}", json={"items": [{**line, "quantity_kg": "150"}]}))
    row = db_session.query(MilledRiceInventory).filter_by(variety_id=variety["id"]).one()
    db_session.refresh(row)
    assert row.quantity_kg == Decimal("350")


def test_a_sale_of_byproducts_takes_them_from_stock(auth_client, db_session):
    customer = _customer(auth_client)
    branch = _branch_id(auth_client)
    db_session.add(
        ByproductInventory(
            company_id=_company_of(db_session, branch),
            branch_id=branch,
            byproduct_type="darak",
            quantity_kg=Decimal(300),
        )
    )
    db_session.flush()
    _ok(_sale(auth_client, customer, item_type="byproduct", byproduct_type="darak"), 201)
    row = db_session.query(ByproductInventory).filter_by(byproduct_type="darak").one()
    db_session.refresh(row)
    assert row.quantity_kg == Decimal("200")


def test_held_stock_cant_be_sold(auth_client, db_session):
    variety, customer = _variety(auth_client), _customer(auth_client)
    _stock(db_session, _branch_id(auth_client), variety["id"], "120")
    hold = _ok(
        auth_client.post(
            "/api/savings/holds",
            json={"stock_type": "milled_rice", "variety_id": variety["id"], "weight_kg": "50", "reason": "pests"},
        ),
        201,
    )
    res = _sale(auth_client, customer, item_type="milled_rice", variety_id=variety["id"])
    assert res.status_code == 409
    assert res.json()["code"] == "stock_on_hold"

    _ok(auth_client.post(f"/api/savings/holds/{hold['id']}/clear", json={}))
    _ok(_sale(auth_client, customer, item_type="milled_rice", variety_id=variety["id"]), 201)


def _buy(client, supplier=None, **line):
    return _ok(
        client.post(
            "/api/paddy/purchases",
            json={
                "supplier_id": supplier["id"] if supplier else None,
                "purchase_date": "2026-10-20",
                "items": [{"gross_weight_kg": "1000", "price_per_cavan": "1000", **line}],
            },
        ),
        201,
    )


def test_deductions_are_off_until_the_boss_turns_them_on(auth_client):
    plain = _buy(auth_client, moisture_content_pct="18", impurity_pct="2")
    assert plain["total_amount"] == 20000.0

    _ok(auth_client.put("/api/savings/settings", json={"pay_deductions": True}))
    deducted = _buy(auth_client, moisture_content_pct="18", impurity_pct="2")
    assert float(deducted["items"][0]["payable_weight_kg"]) == 934.419
    assert deducted["total_amount"] == 18688.38
    # Stock is still what was weighed.
    assert deducted["total_kg"] == 1000.0


def test_vale_comes_off_the_next_purchase(auth_client):
    supplier = _supplier(auth_client)
    _ok(
        auth_client.post(
            "/api/savings/advances",
            json={"supplier_id": supplier["id"], "advance_date": "2026-10-01", "amount": "5000"},
        ),
        201,
    )
    purchase = _buy(auth_client, supplier)
    assert purchase["advance_deducted"] == 5000.0
    assert purchase["net_to_pay"] == 15000.0
    advances = _ok(auth_client.get("/api/savings/advances"))
    assert advances["open_php"] == 0.0

    # A vale taken off can't be voided.
    res = auth_client.post(f"/api/savings/advances/{advances['rows'][0]['id']}/void")
    assert res.status_code == 409


def test_a_vale_larger_than_the_purchase_carries_over(auth_client):
    supplier = _supplier(auth_client)
    _ok(
        auth_client.post(
            "/api/savings/advances",
            json={"supplier_id": supplier["id"], "advance_date": "2026-10-01", "amount": "30000"},
        ),
        201,
    )
    purchase = _buy(auth_client, supplier)
    assert purchase["net_to_pay"] == 0.0
    assert _ok(auth_client.get("/api/savings/advances"))["open_php"] == 10000.0


def test_a_saved_weight_needs_a_reason_to_change(auth_client):
    purchase = _buy(auth_client)
    line = {"gross_weight_kg": "1100", "price_per_cavan": "1000"}
    res = auth_client.patch(f"/api/paddy/purchases/{purchase['id']}", json={"items": [line]})
    assert res.status_code == 409
    assert res.json()["code"] == "weight_reason_required"
    _ok(
        auth_client.patch(
            f"/api/paddy/purchases/{purchase['id']}", json={"items": [line], "weight_change_reason": "Scale was off"}
        )
    )


def test_outputs_cant_weigh_more_than_the_palay(auth_client):
    res = auth_client.post(
        "/api/milling/batches",
        json={
            "start_datetime": "2026-10-20T08:00:00Z",
            "inputs": [{"input_weight_kg": "100"}],
            "outputs": [{"output_type": "milled_rice", "output_weight_kg": "120"}],
        },
    )
    assert res.status_code == 422


def _floor_plan(client, branch):
    _ok(client.get(f"/api/warehouses/{branch}/rack-view"))


def test_milling_puts_real_pallets_on_the_floor_and_sales_take_the_oldest(auth_client, db_session):
    variety, customer = _variety(auth_client), _customer(auth_client)
    branch = _branch_id(auth_client)
    _floor_plan(auth_client, branch)
    for day in ("2026-10-10", "2026-10-15"):
        _ok(
            auth_client.post(
                "/api/milling/batches",
                json={
                    "start_datetime": f"{day}T08:00:00Z",
                    "inputs": [{"input_weight_kg": "500"}],
                    "outputs": [{"output_type": "milled_rice", "variety_id": variety["id"], "output_weight_kg": "300"}],
                },
            ),
            201,
        )
    rows = db_session.query(RiceBatch).filter_by(variety_id=variety["id"]).order_by(RiceBatch.milling_date).all()
    assert [str(r.milling_date) for r in rows] == ["2026-10-10", "2026-10-15"]
    assert all(r.milling_batch_id for r in rows)

    older, newer = rows
    order = _ok(_sale(auth_client, customer, item_type="milled_rice", variety_id=variety["id"], quantity_kg="350"), 201)
    db_session.refresh(older)
    db_session.refresh(newer)
    assert older.weight_kg == Decimal("0")
    assert newer.weight_kg == Decimal("250")
    assert db_session.get(Pallet, older.pallet_id).status == "dispatched"

    _ok(auth_client.put(f"/api/sales/orders/{order['id']}", json={"status": "cancelled"}))
    db_session.refresh(older)
    assert older.weight_kg == Decimal("300")
    assert db_session.get(Pallet, older.pallet_id).status == "in_storage"

    # Sending the newer pallet ahead of the older needs a reason.
    res = auth_client.post(f"/api/savings/pallets/{newer.pallet_id}/pick-first", json={})
    assert res.status_code == 409
    assert res.json()["code"] == "fifo_older_waiting"
    _ok(auth_client.post(f"/api/savings/pallets/{newer.pallet_id}/pick-first", json={"reason": "Buyer asked"}))


def test_a_held_pallet_isnt_sold(auth_client, db_session):
    variety = _variety(auth_client)
    branch = _branch_id(auth_client)
    _floor_plan(auth_client, branch)
    _ok(
        auth_client.post(
            "/api/milling/batches",
            json={
                "start_datetime": "2026-10-10T08:00:00Z",
                "inputs": [{"input_weight_kg": "500"}],
                "outputs": [{"output_type": "milled_rice", "variety_id": variety["id"], "output_weight_kg": "300"}],
            },
        ),
        201,
    )
    row = db_session.query(RiceBatch).filter_by(variety_id=variety["id"]).one()
    _ok(auth_client.post("/api/savings/holds", json={"pallet_id": str(row.pallet_id), "reason": "mould"}), 201)
    assert db_session.get(Pallet, row.pallet_id).status == "on_hold"
    res = _sale(auth_client, _customer(auth_client), item_type="milled_rice", variety_id=variety["id"])
    assert res.status_code == 409


def test_lots_trace_a_batch_back_to_its_purchase(auth_client):
    palay = _variety(auth_client, "PV1", kind="palay")
    supplier = _supplier(auth_client)
    purchase = _buy(auth_client, supplier, variety_id=palay["id"])
    batch = _ok(
        auth_client.post(
            "/api/milling/batches",
            json={
                "start_datetime": "2026-10-21T08:00:00Z",
                "inputs": [{"variety_id": palay["id"], "input_weight_kg": "1200"}],
            },
        ),
        201,
    )
    trace = _ok(auth_client.get(f"/api/savings/batches/{batch['id']}/trace"))
    assert [(lot["reference_no"], lot["weight_kg"]) for lot in trace["lots"]] == [
        (purchase["reference_no"], 1000.0),
        (None, 200.0),
    ]


def test_every_tab_answers_the_boss(auth_client):
    for path in (
        "overview",
        "settings",
        "max-buy",
        "batches",
        "warehouse",
        "movements",
        "capacity",
        "cost-per-sack",
        "advances",
    ):
        _ok(auth_client.get(f"/api/savings/{path}"))


def test_staff_get_no_figures(make_auth_client):
    client = make_auth_client(features=["profit", "sales"], username="till", role_name=STAFF)
    assert client.get("/api/savings/overview").status_code == 403
    res = _ok(client.post("/api/savings/price-check", json={"items": [{"variety_id": None, "price": 1}]}))
    assert all(r["floor"] is None for r in res)


def test_the_page_needs_the_plan(make_auth_client):
    client = make_auth_client(features=["sales"], username="basicboss")
    assert client.get("/api/savings/overview").status_code == 402
    # Sale forms still ask; with nothing to compare, nothing is below cost.
    assert _ok(client.post("/api/savings/price-check", json={"items": [{"variety_id": None, "price": 1}]})) == [
        {"below": False, "floor": None}
    ]
