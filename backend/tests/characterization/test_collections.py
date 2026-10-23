"""The collections list: who to chase first (a promise not kept, then the most
overdue, then those who promised a date still ahead), a reminder to send, and
what happened, recorded."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.collections import reminder, worklist
from app.automations.recipes import RECIPES
from app.models.collections import CollectionFollowUp
from app.models.company import Company
from app.models.sales import Invoice
from app.models.supplier_customer import Customer

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-09-28T08:05+08:00")  # a Monday
TODAY = date(2026, 9, 28)


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


def _customer(db_session, company, name, phone=None, contact=None) -> Customer:
    c = Customer(company_id=company.id, name=name, phone=phone, contact_person=contact, credit_limit=Decimal(0))
    db_session.add(c)
    db_session.flush()
    return c


def _invoice(db_session, customer, no, total, *, due, paid=0, status="unpaid") -> Invoice:
    inv = Invoice(
        invoice_no=no,
        customer_id=customer.id,
        invoice_date=due - timedelta(days=15),
        due_date=due,
        total_amount=Decimal(total),
        paid_amount=Decimal(paid),
        status=status,
    )
    db_session.add(inv)
    db_session.flush()
    return inv


def _promise(db_session, company, customer, *, by, at=NOW):
    db_session.add(
        CollectionFollowUp(
            company_id=company.id,
            customer_id=customer.id,
            outcome="promised",
            promised_date=by,
            promised_amount=Decimal(5000),
            created_at=at,
        )
    )
    db_session.flush()


@pytest.fixture
def debts(db_session, company):
    nena = _customer(db_session, company, "Aling Nena Store", "0917 555 0101", contact="Nena")
    ben = _customer(db_session, company, "Ben's Rice Retail")
    cora = _customer(db_session, company, "Cora Wholesale")
    dina = _customer(db_session, company, "Dina Sari-sari")
    _invoice(db_session, nena, "INV-1", 8_000, due=TODAY - timedelta(days=10), status="overdue")
    _invoice(db_session, ben, "INV-2", 40_000, due=TODAY - timedelta(days=40), status="overdue")
    _invoice(db_session, cora, "INV-3", 90_000, due=TODAY - timedelta(days=5), status="overdue")
    _invoice(db_session, dina, "INV-4", 3_000, due=TODAY + timedelta(days=2))  # due soon
    _invoice(db_session, dina, "INV-5", 9_000, due=TODAY + timedelta(days=30))  # too far off
    # Nena promised last week and didn't pay; Cora promised for Friday.
    _promise(db_session, company, nena, by=TODAY - timedelta(days=2), at=NOW - timedelta(days=6))
    _promise(db_session, company, cora, by=TODAY + timedelta(days=4))
    return nena, ben, cora, dina


def test_a_broken_promise_comes_first_and_a_pending_one_waits(db_session, debts):
    order = [d.customer.name for d in worklist(db_session, TODAY)]
    assert order == ["Aling Nena Store", "Ben's Rice Retail", "Dina Sari-sari", "Cora Wholesale"]
    nena = worklist(db_session, TODAY)[0]
    assert (nena.overdue, nena.oldest_days_late, nena.promise_state(TODAY)) == (Decimal(8000), 10, "broken")


def test_the_reminder_is_firmer_after_a_missed_promise_or_a_month(db_session, debts):
    by_name = {d.customer.name: d for d in worklist(db_session, TODAY)}
    assert reminder(by_name["Aling Nena Store"], "Test Mill", TODAY) == (
        "Good day Nena. This is Test Mill. We were expecting your payment on Saturday 26 September. "
        "₱8,000 is still overdue on invoice INV-1. Please settle it, or tell us the date you can pay. Thank you."
    )
    assert "over a month overdue" in reminder(by_name["Ben's Rice Retail"], "Test Mill", TODAY)
    assert reminder(by_name["Dina Sari-sari"], "Test Mill", TODAY) == (
        "Good day Dina Sari-sari! A friendly reminder from Test Mill: invoice INV-4 for ₱3,000 is due "
        "on Wednesday 30 September. Thank you for your business!"
    )


def test_the_weekly_call_list_names_broken_promises(db_session, company, debts):
    recipe = RECIPES["call_list"]
    [notice] = recipe.build(RecipeContext(db=db_session, company=company, now=NOW, zone=MANILA), recipe.params())
    assert notice.link == "/collections"
    assert notice.body.splitlines() == [
        "1. Aling Nena Store: ₱8,000 overdue, oldest 10 days. 0917 555 0101. Promised to pay by Sat 26 Sep and hasn't",
        "2. Ben's Rice Retail: ₱40,000 overdue, oldest 40 days",
        "3. Cora Wholesale: ₱90,000 overdue, oldest 5 days. Promised to pay by Fri 02 Oct",
    ]


def test_the_list_and_what_happened_over_the_api(auth_client, db_session, debts):
    nena = debts[0]
    body = auth_client.get("/api/collections/").json()
    # The API counts from the mill's real today, by which both promises are past.
    [first] = [c for c in body["customers"] if c["customer"]["name"] == "Aling Nena Store"]
    assert first["customer"]["name"] == "Aling Nena Store"
    assert first["promise"] == "broken"
    assert first["last_follow_up"] == "Promised to pay ₱5,000 by Sat 26 Sep"
    assert first["reminder"].startswith("Good day Nena.")

    res = auth_client.post(f"/api/collections/{nena.id}/follow-ups", json={"outcome": "promised"})
    assert res.status_code == 422  # a promise needs a date
    res = auth_client.post(
        f"/api/collections/{nena.id}/follow-ups",
        json={"outcome": "promised", "promised_date": "2026-10-02", "note": "Paying after harvest sale."},
    )
    assert res.status_code == 201, res.text
    history = auth_client.get(f"/api/collections/{nena.id}/follow-ups").json()["follow_ups"]
    assert history[0]["summary"] == "Promised to pay by Fri 02 Oct (Test Owner)"
    assert history[0]["note"] == "Paying after harvest sale."


def test_collections_need_the_pro_feature_and_sales_access(make_auth_client):
    assert make_auth_client(features=["sales"], username="basic").get("/api/collections/").status_code == 402
    floor = make_auth_client(features=["collections"], username="floor", role_name="mill_operator")
    assert floor.get("/api/collections/").status_code == 403


def test_no_debts_no_list(auth_client, db_session, company):
    assert auth_client.get("/api/collections/").json()["customers"] == []
    assert datetime.now(timezone.utc)  # the endpoint uses the mill's own today
