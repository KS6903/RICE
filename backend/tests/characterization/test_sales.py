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
    order = auth_client.post("/api/sales/orders", json={
        "customer_id": customer["id"],
        "order_date": "2026-06-05",
        "discount_pct": "10",
        "items": [{"item_type": "milled_rice", "quantity_kg": "100", "unit_price_per_kg": "50"}],
    })
    assert order.status_code == 201, order.text
    o = order.json()
    assert re.match(r"^SO-\d{8}-\d{4}$", o["order_no"]), o["order_no"]
    assert o["status"] == "confirmed"
    assert float(o["subtotal"]) == 5000.0
    assert float(o["total_amount"]) == 4500.0

    # Invoice from the order.
    invoice = auth_client.post("/api/sales/invoices", json={
        "order_id": o["id"], "invoice_date": "2026-06-05",
    })
    assert invoice.status_code == 201, invoice.text
    inv = invoice.json()
    assert re.match(r"^INV-\d{8}-\d{4}$", inv["invoice_no"]), inv["invoice_no"]
    assert inv["status"] == "unpaid"
    assert float(inv["total_amount"]) == 4500.0

    # The order flips to "invoiced".
    orders = auth_client.get("/api/sales/orders").json()
    assert next(x for x in orders if x["id"] == o["id"])["status"] == "invoiced"

    # Full payment marks the invoice paid.
    pay = auth_client.post("/api/sales/payments", json={
        "invoice_id": inv["id"], "payment_date": "2026-06-05",
        "amount": "4500", "method": "cash",
    })
    assert pay.status_code == 201, pay.text

    invoices = auth_client.get("/api/sales/invoices").json()
    paid = next(x for x in invoices if x["id"] == inv["id"])
    assert paid["status"] == "paid"
    assert float(paid["paid_amount"]) == 4500.0


def test_invoice_for_unknown_order_404(auth_client):
    res = auth_client.post("/api/sales/invoices", json={
        "order_id": "00000000-0000-0000-0000-000000000000", "invoice_date": "2026-06-05",
    })
    assert res.status_code == 404
