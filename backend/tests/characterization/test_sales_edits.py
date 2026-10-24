"""The Boss corrects saved sales records, and every change to an order, an
invoice or a customer is logged, field by field, in that record's history."""

from __future__ import annotations


def _customer(c, name="Edit Co", **extra):
    res = c.post("/api/sales/customers", json={"name": name, **extra})
    assert res.status_code == 201, res.text
    return res.json()


def _order(c, customer_id, kg="100", price="50", discount="0"):
    res = c.post(
        "/api/sales/orders",
        json={
            "customer_id": customer_id,
            "order_date": "2026-10-20",
            "discount_pct": discount,
            "items": [{"item_type": "milled_rice", "quantity_kg": kg, "unit_price_per_kg": price}],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def _history(c, kind, record_id):
    res = c.get(f"/api/sales/history/{kind}/{record_id}")
    assert res.status_code == 200, res.text
    return res.json()


def test_the_boss_corrects_an_order_and_its_invoice_follows(auth_client):
    customer = _customer(auth_client)
    order = _order(auth_client, customer["id"])
    invoice = auth_client.post(
        "/api/sales/invoices", json={"order_id": order["id"], "invoice_date": "2026-10-20"}
    ).json()
    auth_client.post(
        "/api/sales/payments",
        json={"invoice_id": invoice["id"], "payment_date": "2026-10-20", "amount": "5000", "method": "cash"},
    )

    # 100 kg became 120 kg: 6,000, of which 5,000 is already paid.
    res = auth_client.patch(
        f"/api/sales/orders/{order['id']}",
        json={
            "items": [{"item_type": "milled_rice", "quantity_kg": "120", "unit_price_per_kg": "50"}],
            "remarks": "Short-weighed on the first count",
        },
    )
    assert res.status_code == 200, res.text
    edited = res.json()
    assert float(edited["total_amount"]) == 6000.0
    assert edited["status"] == "invoiced"

    inv = next(i for i in auth_client.get("/api/sales/invoices").json() if i["id"] == invoice["id"])
    assert float(inv["total_amount"]) == 6000.0
    assert float(inv["paid_amount"]) == 5000.0
    assert inv["status"] == "partial"

    [entry] = _history(auth_client, "sales_order", order["id"])
    assert entry["action"] == "sales_order.edit"
    assert "Items: milled rice 100 kg at ₱50 → milled rice 120 kg at ₱50" in entry["detail"]
    assert "Total (₱): 5,000 → 6,000" in entry["detail"]
    assert "Remarks: blank → Short-weighed on the first count" in entry["detail"]

    [inv_entry] = _history(auth_client, "invoice", invoice["id"])
    assert "Total (₱): 5,000 → 6,000" in inv_entry["detail"]
    assert "Status: paid → partial" in inv_entry["detail"]
    assert f"Follows the edit to order {order['order_no']}" in inv_entry["detail"]


def test_only_the_boss_can_edit_saved_records(make_auth_client):
    cashier = make_auth_client(["sales"], username="till", role_name="cashier")
    customer = _customer(cashier)
    order = _order(cashier, customer["id"])
    res = cashier.patch(f"/api/sales/orders/{order['id']}", json={"remarks": "x"})
    assert res.status_code == 403
    assert "Only the Boss" in res.json()["detail"]
    assert _history(cashier, "sales_order", order["id"]) == []


def test_customer_changes_are_logged_and_a_no_change_save_logs_nothing(auth_client):
    customer = _customer(auth_client, phone="0917")
    auth_client.put(f"/api/sales/customers/{customer['id']}", json={"phone": "0917"})
    assert _history(auth_client, "customer", customer["id"]) == []

    auth_client.put(
        f"/api/sales/customers/{customer['id']}",
        json={"phone": "0918", "credit_limit": "25000"},
    )
    [entry] = _history(auth_client, "customer", customer["id"])
    assert entry["action"] == "customer.edit"
    assert "Phone: 0917 → 0918" in entry["detail"]
    assert "Credit limit (₱): 0 → 25,000" in entry["detail"]


def test_the_boss_corrects_an_invoice_date_and_it_is_logged(auth_client):
    customer = _customer(auth_client)
    order = _order(auth_client, customer["id"])
    invoice = auth_client.post(
        "/api/sales/invoices", json={"order_id": order["id"], "invoice_date": "2026-10-20"}
    ).json()
    res = auth_client.patch(
        f"/api/sales/invoices/{invoice['id']}", json={"invoice_date": "2026-10-21", "due_date": "2026-11-20"}
    )
    assert res.status_code == 200, res.text
    [entry] = _history(auth_client, "invoice", invoice["id"])
    assert "Invoice date: 2026-10-20 → 2026-10-21" in entry["detail"]
    assert "Due date: 2026-10-20 → 2026-11-20" in entry["detail"]


def test_delivery_changes_go_in_the_orders_history(auth_client):
    customer = _customer(auth_client)
    order = _order(auth_client, customer["id"])
    res = auth_client.patch(
        f"/api/sales-orders/{order['id']}/assign-courier",
        json={"courier_type": "mill", "plate_number": "ABC 123", "driver_name": "Juan"},
    )
    assert res.status_code == 200, res.text
    [entry] = _history(auth_client, "sales_order", order["id"])
    assert "Who delivers: blank → mill" in entry["detail"]
    assert "Plate: blank → ABC 123" in entry["detail"]


def test_another_mills_order_cannot_be_edited_or_read(make_auth_client):
    theirs = make_auth_client(["sales"], username="theirs")
    their_order = _order(theirs, _customer(theirs, name="Their customer")["id"])
    theirs.patch(f"/api/sales/orders/{their_order['id']}", json={"remarks": "theirs"})

    mine = make_auth_client(["sales"], username="mine")
    res = mine.patch(f"/api/sales/orders/{their_order['id']}", json={"remarks": "mine"})
    assert res.status_code == 404
    assert _history(mine, "sales_order", their_order["id"]) == []
