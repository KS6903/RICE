"""Characterization: the sales domain (Phase 3 target).

Pins customer CRUD and the order -> invoice -> payment money flow, including the
computed totals, the document-number formats, and the status transitions.
"""

import re


def test_create_customer_assigns_canva_color(auth_client):
    res = auth_client.post("/api/sales/customers", json={"name": "ACME Trading"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "ACME Trading"
    assert body["canva_color_hex"]


def test_order_invoice_payment_flow(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Flow Co"}).json()

    # Order: 100kg @ 50 = 5000 subtotal, 10% discount -> 4500 total.
    order = auth_client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-06-05",
            "discount_pct": "10",
            "items": [{"item_type": "milled_rice", "quantity_kg": "100", "unit_price_per_kg": "50"}],
        },
    )
    assert order.status_code == 201, order.text
    o = order.json()
    assert re.match(r"^TM-\d{4,}$", o["order_no"]), o["order_no"]
    assert o["status"] == "confirmed"
    assert float(o["subtotal"]) == 5000.0
    assert float(o["total_amount"]) == 4500.0

    # Invoice from the order.
    invoice = auth_client.post(
        "/api/sales/invoices",
        json={
            "order_id": o["id"],
            "invoice_date": "2026-06-05",
        },
    )
    assert invoice.status_code == 201, invoice.text
    inv = invoice.json()
    assert re.match(r"^INV-\d{8}-\d{4}$", inv["invoice_no"]), inv["invoice_no"]
    assert inv["status"] == "unpaid"
    assert float(inv["total_amount"]) == 4500.0

    # The order flips to "invoiced".
    orders = auth_client.get("/api/sales/orders").json()
    assert next(x for x in orders if x["id"] == o["id"])["status"] == "invoiced"

    # Full payment marks the invoice paid.
    pay = auth_client.post(
        "/api/sales/payments",
        json={
            "invoice_id": inv["id"],
            "payment_date": "2026-06-05",
            "amount": "4500",
            "method": "cash",
        },
    )
    assert pay.status_code == 201, pay.text

    invoices = auth_client.get("/api/sales/invoices").json()
    paid = next(x for x in invoices if x["id"] == inv["id"])
    assert paid["status"] == "paid"
    assert float(paid["paid_amount"]) == 4500.0


def test_order_list_carries_customer_and_items_for_the_invoice_preview(auth_client):
    customer = auth_client.post(
        "/api/sales/customers",
        json={"name": "Preview Co", "address": "Cabanatuan City", "tin": "123-456-789", "payment_terms_days": 15},
    ).json()
    created = auth_client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-06-05",
            "discount_pct": "10",
            "items": [
                {"item_type": "milled_rice", "grade_name": "premium", "quantity_kg": "100", "unit_price_per_kg": "50"},
                {"item_type": "byproduct", "quantity_kg": "20", "unit_price_per_kg": "5"},
            ],
        },
    )
    assert created.status_code == 201, created.text

    order = auth_client.get("/api/sales/orders").json()[0]
    assert order["customer"] == {
        "id": customer["id"],
        "name": "Preview Co",
        "address": "Cabanatuan City",
        "tin": "123-456-789",
        "payment_terms_days": 15,
    }
    assert len(order["items"]) == 2
    rice = next(i for i in order["items"] if i["item_type"] == "milled_rice")
    assert rice["grade_name"] == "premium"
    assert float(rice["quantity_kg"]) == 100.0
    assert float(rice["unit_price_per_kg"]) == 50.0
    assert float(rice["line_total"]) == 5000.0


def test_order_rejects_negative_price_quantity_and_discount(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Negative Co"}).json()
    ok_item = {"item_type": "milled_rice", "quantity_kg": "10", "unit_price_per_kg": "50"}

    def order(item=None, **extra):
        body = {
            "customer_id": customer["id"],
            "order_date": "2026-06-05",
            "items": [{**ok_item, **(item or {})}],
            **extra,
        }
        return auth_client.post("/api/sales/orders", json=body)

    assert order({"unit_price_per_kg": "-1"}).status_code == 422
    assert order({"quantity_kg": "-5"}).status_code == 422
    assert order({"quantity_kg": "0"}).status_code == 422
    assert order(discount_pct="-10").status_code == 422
    assert order(discount_pct="101").status_code == 422
    # A free item (price 0) and a 100% discount are still allowed.
    assert order({"unit_price_per_kg": "0"}).status_code == 201
    assert order(discount_pct="100").status_code == 201


def test_order_numbers_are_short_and_keep_counting(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Numbers Co"}).json()

    def place():
        res = auth_client.post(
            "/api/sales/orders",
            json={
                "customer_id": customer["id"],
                "order_date": "2026-06-05",
                "items": [{"item_type": "milled_rice", "quantity_kg": "1", "unit_price_per_kg": "1"}],
            },
        )
        assert res.status_code == 201, res.text
        return res.json()["order_no"]

    # "Test Mill" is TM: the number carries the rice mill's own code.
    assert [place(), place(), place()] == ["TM-0001", "TM-0002", "TM-0003"]


def test_invoice_for_unknown_order_404(auth_client):
    res = auth_client.post(
        "/api/sales/invoices",
        json={
            "order_id": "00000000-0000-0000-0000-000000000000",
            "invoice_date": "2026-06-05",
        },
    )
    assert res.status_code == 404


# ── what an order sells: rice, by-products and palay (the Buy & mill pages) ──


def _order(c, customer_id, *items, day="2026-10-17"):
    res = c.post(
        "/api/sales/orders",
        json={"customer_id": customer_id, "order_date": day, "items": list(items)},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_orders_sell_palay_too_and_list_by_what_they_sell(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Trader Co"}).json()
    variety = auth_client.post("/api/paddy/varieties", json={"code": "RC400", "name": "NSIC Rc400"}).json()
    palay = _order(
        auth_client,
        customer["id"],
        {
            "item_type": "palay",
            "variety_id": variety["id"],
            "grade_name": "A",
            "quantity_kg": "1000",
            "unit_price_per_kg": "22",
        },
    )
    rice = _order(
        auth_client, customer["id"], {"item_type": "milled_rice", "quantity_kg": "50", "unit_price_per_kg": "48"}
    )
    mixed = _order(
        auth_client,
        customer["id"],
        {"item_type": "milled_rice", "quantity_kg": "50", "unit_price_per_kg": "48"},
        {"item_type": "byproduct", "byproduct_type": "darak", "quantity_kg": "100", "unit_price_per_kg": "14"},
    )

    def listed(item_type):
        return {o["id"] for o in auth_client.get("/api/sales/orders", params={"item_type": item_type}).json()}

    assert listed("palay") == {palay["id"]}
    assert listed("milled_rice") == {rice["id"], mixed["id"]}
    assert listed("byproduct") == {mixed["id"]}
    assert len(auth_client.get("/api/sales/orders").json()) == 3

    line = auth_client.get("/api/sales/orders", params={"item_type": "palay"}).json()[0]["items"][0]
    assert line["variety_code"] == "RC400"
    assert line["grade_name"] == "A"
    assert float(line["line_total"]) == 22000.0


def test_order_lines_sell_rice_byproducts_or_palay_only(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Odd Co"}).json()
    res = auth_client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer["id"],
            "order_date": "2026-10-17",
            "items": [{"item_type": "sugar", "quantity_kg": "1", "unit_price_per_kg": "1"}],
        },
    )
    assert res.status_code == 422


def test_order_says_whether_it_was_billed_and_paid(auth_client):
    customer = auth_client.post("/api/sales/customers", json={"name": "Billed Co"}).json()
    order = _order(
        auth_client, customer["id"], {"item_type": "milled_rice", "quantity_kg": "10", "unit_price_per_kg": "50"}
    )
    assert auth_client.get("/api/sales/orders").json()[0]["invoice"] is None

    inv = auth_client.post("/api/sales/invoices", json={"order_id": order["id"], "invoice_date": "2026-10-17"}).json()
    auth_client.post(
        "/api/sales/payments",
        json={"invoice_id": inv["id"], "payment_date": "2026-10-17", "amount": "200", "method": "cash"},
    )
    billed = auth_client.get("/api/sales/orders").json()[0]["invoice"]
    assert billed["invoice_no"] == inv["invoice_no"]
    assert billed["status"] == "partial"
    assert float(billed["paid_amount"]) == 200.0
