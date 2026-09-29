"""Receivables, for every plan: an invoice ages from a due date, goes overdue on
schedule, and only full payment clears it."""

from __future__ import annotations

from datetime import date

from sqlalchemy import update

from app.models.sales import Invoice
from app.services.reports_service import ReportsService
from app.services.sales_service import mark_overdue_invoices


def _customer(client, name: str, **fields) -> dict:
    res = client.post("/api/sales/customers", json={"name": name, **fields})
    assert res.status_code == 201, res.text
    return res.json()


def _invoice(client, customer_id: str, day: str, **fields) -> dict:
    """An order of 100 kg at 50 (total 5,000) invoiced on ``day``."""
    order = client.post(
        "/api/sales/orders",
        json={
            "customer_id": customer_id,
            "order_date": day,
            "discount_pct": "0",
            "items": [{"item_type": "milled_rice", "quantity_kg": "100", "unit_price_per_kg": "50"}],
        },
    )
    assert order.status_code == 201, order.text
    res = client.post("/api/sales/invoices", json={"order_id": order.json()["id"], "invoice_date": day, **fields})
    assert res.status_code == 201, res.text
    return res.json()


def _pay(client, invoice_id: str, amount: str, day: str = "2026-06-26") -> None:
    res = client.post(
        "/api/sales/payments",
        json={"invoice_id": invoice_id, "payment_date": day, "amount": amount, "method": "cash"},
    )
    assert res.status_code == 201, res.text


def _status(client, invoice_id: str) -> str:
    return next(i["status"] for i in client.get("/api/sales/invoices").json() if i["id"] == invoice_id)


def test_the_due_date_defaults_to_the_customer_payment_terms(auth_client):
    customer = _customer(auth_client, "Terms Co", payment_terms_days=30)
    assert _invoice(auth_client, customer["id"], "2026-06-05")["due_date"] == "2026-07-05"


def test_without_payment_terms_an_invoice_is_due_on_its_date(auth_client):
    customer = _customer(auth_client, "Cash Co")
    assert _invoice(auth_client, customer["id"], "2026-06-05")["due_date"] == "2026-06-05"


def test_an_explicit_due_date_is_kept(auth_client):
    customer = _customer(auth_client, "Explicit Co", payment_terms_days=30)
    invoice = _invoice(auth_client, customer["id"], "2026-06-05", due_date="2026-06-20")
    assert invoice["due_date"] == "2026-06-20"


def test_overdue_marking_touches_only_unpaid_invoices_past_due(auth_client, db_session):
    customer = _customer(auth_client, "Late Co", payment_terms_days=10)
    late = _invoice(auth_client, customer["id"], "2026-06-01")  # due 06-11
    not_yet = _invoice(auth_client, customer["id"], "2026-06-20")  # due 06-30
    paid = _invoice(auth_client, customer["id"], "2026-06-01")  # due 06-11, settled
    _pay(auth_client, paid["id"], "5000", day="2026-06-02")

    assert mark_overdue_invoices(db_session, today=date(2026, 6, 25)) == 1
    db_session.commit()
    assert _status(auth_client, late["id"]) == "overdue"
    assert _status(auth_client, not_yet["id"]) == "unpaid"
    assert _status(auth_client, paid["id"]) == "paid"
    # Running again the same day changes nothing.
    assert mark_overdue_invoices(db_session, today=date(2026, 6, 25)) == 0


def test_a_part_payment_does_not_cure_an_overdue_invoice(auth_client, db_session):
    customer = _customer(auth_client, "Partial Co", payment_terms_days=10)
    invoice = _invoice(auth_client, customer["id"], "2026-06-01")
    mark_overdue_invoices(db_session, today=date(2026, 6, 25))
    db_session.commit()

    _pay(auth_client, invoice["id"], "1000")
    assert _status(auth_client, invoice["id"]) == "overdue"
    _pay(auth_client, invoice["id"], "4000")
    assert _status(auth_client, invoice["id"]) == "paid"


def test_a_part_payment_before_the_due_date_is_partial(auth_client):
    customer = _customer(auth_client, "Early Co", payment_terms_days=30)
    invoice = _invoice(auth_client, customer["id"], "2026-06-01")
    _pay(auth_client, invoice["id"], "1000", day="2026-06-02")
    assert _status(auth_client, invoice["id"]) == "partial"


def test_ar_aging_buckets_by_days_past_due(auth_client, db_session, seed_owner):
    customer = _customer(auth_client, "Aging Co", payment_terms_days=0)
    _invoice(auth_client, customer["id"], "2026-07-15")  # 5 days past due on 07-20
    _invoice(auth_client, customer["id"], "2026-05-01")  # 80 days past due
    _invoice(auth_client, customer["id"], "2026-07-25")  # not yet due
    buckets = ReportsService(db_session, seed_owner).ar_aging(today=date(2026, 7, 20))
    assert buckets == {"current": 5000.0, "1_30": 5000.0, "31_60": 0, "61_90": 5000.0, "over_90": 0}


def test_ar_aging_counts_an_invoice_with_no_due_date_from_its_invoice_date(auth_client, db_session, seed_owner):
    # Invoices created before due dates were defaulted have none, and used to be
    # left out of every bucket.
    customer = _customer(auth_client, "Legacy Co")
    invoice = _invoice(auth_client, customer["id"], "2026-06-01")
    db_session.execute(update(Invoice).where(Invoice.id == invoice["id"]).values(due_date=None))
    db_session.commit()
    buckets = ReportsService(db_session, seed_owner).ar_aging(today=date(2026, 7, 20))
    assert buckets["31_60"] == 5000.0
