"""Collections, credit and deliveries: the right invoices and customers are
named, the credit guard warns or blocks as set, and deliveries are chased."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.credit import owed
from app.automations.recipes import RECIPES
from app.jobs.schedule import daily, monthly, weekly
from app.models.automation import AutomationRule
from app.models.company import Company
from app.models.fleet import DispatchTrip, Driver, Truck
from app.models.notification import Notification
from app.models.sales import Invoice, SalesOrder
from app.models.supplier_customer import Customer

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-09-29T08:05+08:00")  # a Tuesday
TODAY = date(2026, 9, 29)


def _build(db_session, company, code, *, now=NOW, **params):
    recipe = RECIPES[code]
    ctx = RecipeContext(db=db_session, company=company, now=now, zone=MANILA)
    return recipe.build(ctx, recipe.params(**params))


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


def _customer(db_session, name, *, limit=0, phone=None, company_id=None) -> Customer:
    if company_id is None:  # the seeded owner's mill
        company_id = db_session.query(Company).filter(Company.name == "Test Mill").one().id
    c = Customer(company_id=company_id, name=name, credit_limit=Decimal(limit), payment_terms_days=0, phone=phone)
    db_session.add(c)
    db_session.flush()
    return c


def _invoice(db_session, customer, no, *, total, paid=0, due, status="unpaid") -> Invoice:
    inv = Invoice(
        invoice_no=no,
        customer_id=customer.id if customer else None,
        invoice_date=due - timedelta(days=15),
        due_date=due,
        total_amount=Decimal(total),
        paid_amount=Decimal(paid),
        status=status,
    )
    db_session.add(inv)
    db_session.flush()
    return inv


def _order(db_session, customer, no, *, total, day=TODAY, status="confirmed", delivery=None) -> SalesOrder:
    o = SalesOrder(
        order_no=no,
        customer_id=customer.id if customer else None,
        order_date=day,
        delivery_date=delivery,
        total_amount=Decimal(total),
        status=status,
    )
    db_session.add(o)
    db_session.flush()
    return o


# ── schedules ────────────────────────────────────────────────────────────────


def test_weekday_weekly_and_monthly_schedules():
    from datetime import time

    sunday = datetime.fromisoformat("2026-10-04T09:00+08:00")
    mon_to_sat = daily(time(8, 0), days=frozenset(range(0, 6)))
    assert mon_to_sat(sunday, MANILA) is None
    assert mon_to_sat(NOW, MANILA) == "2026-09-29"
    monday = weekly(0, time(8, 0))
    assert monday(NOW, MANILA) is None  # Tuesday
    assert monday(datetime.fromisoformat("2026-09-28T08:01+08:00"), MANILA) == "2026-W40"
    first = monthly(1, time(7, 0))
    assert first(datetime.fromisoformat("2026-10-01T06:59+08:00"), MANILA) is None
    assert first(datetime.fromisoformat("2026-10-01T07:00+08:00"), MANILA) == "2026-10"
    assert first(datetime.fromisoformat("2026-10-20T07:00+08:00"), MANILA) == "2026-10"


# ── collections ──────────────────────────────────────────────────────────────


def test_the_morning_list_puts_overdue_first_then_due_soon(db_session, company):
    nena = _customer(db_session, "Aling Nena Store", phone="0917 555 0101")
    ben = _customer(db_session, "Ben's Rice Retail")
    _invoice(db_session, nena, "INV-1", total=10_000, paid=2_500, due=TODAY - timedelta(days=12), status="overdue")
    _invoice(db_session, ben, "INV-2", total=8_000, due=TODAY + timedelta(days=2))
    _invoice(db_session, ben, "INV-3", total=5_000, due=TODAY)
    _invoice(db_session, ben, "INV-4", total=9_000, due=TODAY + timedelta(days=10))  # not soon enough
    _invoice(db_session, ben, "INV-5", total=3_000, paid=3_000, due=TODAY - timedelta(days=1), status="paid")
    [notice] = _build(db_session, company, "due_reminders", days_before=3)
    assert notice.title == "Collections: 1 overdue invoice, 2 due soon"
    assert notice.body.splitlines() == [
        "Overdue (₱7,500):",
        "INV-1, Aling Nena Store: ₱7,500, 12 days late. 0917 555 0101",
        "Due soon (₱13,000):",
        "INV-3, Ben's Rice Retail: ₱5,000, due today",
        "INV-2, Ben's Rice Retail: ₱8,000, due Thu 01 Oct",
    ]


def test_the_call_list_ranks_customers_by_overdue_money(db_session, company):
    nena = _customer(db_session, "Aling Nena Store", phone="0917 555 0101")
    ben = _customer(db_session, "Ben's Rice Retail")
    _invoice(db_session, nena, "INV-1", total=10_000, due=TODAY - timedelta(days=40), status="overdue")
    _invoice(db_session, ben, "INV-2", total=30_000, due=TODAY - timedelta(days=5), status="overdue")
    _invoice(db_session, ben, "INV-3", total=4_000, due=TODAY - timedelta(days=20), status="overdue")
    _invoice(db_session, ben, "INV-4", total=99_000, due=TODAY + timedelta(days=5))  # not overdue
    [notice] = _build(db_session, company, "call_list")
    assert notice.title == "Who to call this week: ₱44,000 overdue"
    assert notice.body.splitlines() == [
        "1. Ben's Rice Retail: ₱34,000 overdue, oldest 20 days",
        "2. Aling Nena Store: ₱10,000 overdue, oldest 40 days. 0917 555 0101",
    ]
    assert notice.dedupe_key == "call_list:2026-W40"


# ── credit ───────────────────────────────────────────────────────────────────


def test_what_a_customer_owes_counts_open_invoices_and_uninvoiced_orders(db_session, company):
    nena = _customer(db_session, "Aling Nena Store", limit=50_000)
    invoiced = _order(db_session, nena, "SO-1", total=20_000, status="invoiced")
    inv = _invoice(db_session, nena, "INV-1", total=20_000, paid=5_000, due=TODAY)
    inv.order_id = invoiced.id
    _order(db_session, nena, "SO-2", total=12_000)  # not invoiced yet
    _order(db_session, nena, "SO-3", total=99_000, status="cancelled")
    _order(db_session, nena, "SO-4", total=99_000, status="draft")
    db_session.flush()
    assert owed(db_session, [nena.id]) == {nena.id: Decimal(27_000)}


def _guard(db_session, company, mode):
    db_session.add(
        AutomationRule(company_id=company.id, recipe="credit_guard", enabled=True, params={"mode": mode}, recipients=[])
    )
    db_session.flush()


def _order_body(customer, kg=1000, price=50):
    return {
        "customer_id": str(customer.id),
        "order_date": TODAY.isoformat(),
        "items": [{"item_type": "milled_rice", "quantity_kg": kg, "unit_price_per_kg": price}],
    }


def test_the_guard_blocks_an_order_over_the_limit_until_the_owner_approves(
    auth_client, db_session, company, seed_owner
):
    nena = _customer(db_session, "Aling Nena Store", limit=60_000)
    _order(db_session, nena, "SO-OPEN", total=20_000)
    _guard(db_session, company, "block")

    res = auth_client.post("/api/sales/orders", json=_order_body(nena))  # ₱50,000 more: ₱70,000
    assert res.status_code == 409
    assert res.json()["code"] == "over_credit_limit"
    assert res.json()["detail"] == (
        "Aling Nena Store would owe ₱70,000 with this ₱50,000 order, over their ₱60,000 credit limit. "
        "They owe ₱20,000 now. Approve it to go ahead."
    )

    res = auth_client.post("/api/sales/orders", json={**_order_body(nena), "approve_over_limit": True})
    assert res.status_code == 201, res.text
    db_session.expire_all()
    [notice] = db_session.query(Notification).filter(Notification.user_id == seed_owner.id).all()
    assert notice.title.startswith("Order over credit limit: TM-")
    assert notice.body.endswith("Approved over the limit by Test Owner.")


def test_staff_cannot_approve_their_own_way_past_the_guard(make_auth_client, db_session):
    client = make_auth_client(features=["automations", "sales"], username="enc", role_name="encoder")
    company_id = db_session.query(Company).filter(Company.name == "Co enc1").one().id
    nena = _customer(db_session, "Aling Nena Store", limit=10_000, company_id=company_id)
    db_session.add(
        AutomationRule(
            company_id=company_id, recipe="credit_guard", enabled=True, params={"mode": "block"}, recipients=[]
        )
    )
    db_session.flush()
    res = client.post("/api/sales/orders", json={**_order_body(nena), "approve_over_limit": True})
    assert res.status_code == 409
    assert res.json()["detail"].endswith("An owner or admin can approve it.")


def test_in_warn_mode_the_order_goes_through_and_the_owner_hears(auth_client, db_session, company, seed_owner):
    nena = _customer(db_session, "Aling Nena Store", limit=10_000)
    _guard(db_session, company, "warn")
    assert auth_client.post("/api/sales/orders", json=_order_body(nena)).status_code == 201
    db_session.expire_all()
    [notice] = db_session.query(Notification).filter(Notification.user_id == seed_owner.id).all()
    assert notice.body.endswith("Entered by Test Owner.")


def test_no_guard_without_the_rule_or_without_a_limit(auth_client, db_session, company):
    nena = _customer(db_session, "Aling Nena Store", limit=10_000)
    assert auth_client.post("/api/sales/orders", json=_order_body(nena)).status_code == 201  # rule off
    _guard(db_session, company, "block")
    unlimited = _customer(db_session, "Walk-in Wholesale", limit=0)
    assert auth_client.post("/api/sales/orders", json=_order_body(unlimited)).status_code == 201


def _offline_order(customer, *, total, no="SO-OFF-1"):
    import uuid

    return {
        "table_name": "sales_orders",
        "record_id": str(uuid.uuid4()),
        "operation": "INSERT",
        "payload": {
            "order_no": no,
            "order_date": TODAY.isoformat(),
            "customer_id": str(customer.id),
            "total_amount": total,
            "status": "confirmed",
        },
        "updated_at": "2026-09-29T00:00:00Z",
    }


def _offline_client(make_auth_client, db_session, *, mode="block"):
    client = make_auth_client(features=["automations", "offline_sync", "sales"], username="desk")
    company = db_session.query(Company).filter(Company.name.like("Co desk%")).one()
    _guard(db_session, company, mode)
    return client, company


def test_an_offline_order_over_the_limit_is_sent_for_review_when_it_syncs(make_auth_client, db_session):
    client, company = _offline_client(make_auth_client, db_session)
    nena = _customer(db_session, "Aling Nena Store", limit=60_000, company_id=company.id)
    _order(db_session, nena, "SO-OPEN", total=20_000)

    res = client.post(
        "/api/sync/push",
        json={"client_id": "electron-12345678", "records": [_offline_order(nena, total=50_000)]},
    )
    assert res.status_code == 200, res.text
    # Synced, not refused: the order was already taken.
    assert res.json() == {"synced": 1, "conflicts": 0, "for_review": 1}
    db_session.expire_all()
    [notice] = db_session.query(Notification).all()
    assert notice.title == "Offline order over credit limit: SO-OFF-1"
    assert notice.body.splitlines() == [
        "Aling Nena Store would owe ₱70,000 with this ₱50,000 order, over their ₱60,000 credit limit. "
        "They owe ₱20,000 now.",
        "Entered by Test User on the desktop app while offline, where the limit can't be checked. "
        "Please review it: confirm it, or ask for payment before delivery.",
    ]


def test_offline_orders_within_the_limit_or_without_the_guard_pass_quietly(make_auth_client, db_session):
    client = make_auth_client(features=["automations", "offline_sync", "sales"], username="quiet")
    company = db_session.query(Company).filter(Company.name.like("Co quiet%")).one()
    nena = _customer(db_session, "Aling Nena Store", limit=10_000, company_id=company.id)
    push = {"client_id": "electron-12345678", "records": [_offline_order(nena, total=50_000)]}
    assert client.post("/api/sync/push", json=push).json()["for_review"] == 0  # guard off
    _guard(db_session, company, "warn")
    small = {"client_id": "electron-12345678", "records": [_offline_order(nena, total=5_000, no="SO-OFF-2")]}
    assert client.post("/api/sync/push", json=small).json()["for_review"] == 0
    db_session.expire_all()
    assert db_session.query(Notification).count() == 0


def test_the_morning_check_names_customers_newly_over_their_limit(db_session, company):
    nena = _customer(db_session, "Aling Nena Store", limit=10_000)
    _customer(db_session, "Ben's Rice Retail", limit=50_000)
    _order(db_session, nena, "SO-1", total=15_000)
    [notice] = _build(db_session, company, "credit_guard")
    assert notice.title == "Over their credit limit: 1 customer"
    assert notice.body == "Aling Nena Store: owes ₱15,000 on a ₱10,000 limit"
    assert _build(db_session, company, "credit_guard", now=NOW + timedelta(days=1)) == []


# ── quiet customers ──────────────────────────────────────────────────────────


def test_regular_customers_who_stopped_ordering_are_named_once(db_session, company):
    nena = _customer(db_session, "Aling Nena Store", phone="0917 555 0101")
    ben = _customer(db_session, "Ben's Rice Retail")
    once = _customer(db_session, "One-off Buyer")
    for days_ago in (100, 80, 60, 45):
        _order(db_session, nena, f"SO-N{days_ago}", total=1_000, day=TODAY - timedelta(days=days_ago))
    for days_ago in (30, 20, 3):
        _order(db_session, ben, f"SO-B{days_ago}", total=1_000, day=TODAY - timedelta(days=days_ago))
    _order(db_session, once, "SO-O", total=1_000, day=TODAY - timedelta(days=90))
    [notice] = _build(db_session, company, "quiet_customers", days=30)
    assert notice.body == (
        "Aling Nena Store: last ordered 15 Aug (45 days ago), 4 orders in the 6 months before. 0917 555 0101"
    )
    assert _build(db_session, company, "quiet_customers", now=NOW + timedelta(days=7), days=30) == []


# ── deliveries ───────────────────────────────────────────────────────────────


def test_late_deliveries_are_named_once(db_session, company):
    nena = _customer(db_session, "Aling Nena Store")
    _order(db_session, nena, "SO-LATE", total=5_000, delivery=TODAY - timedelta(days=2))
    _order(db_session, nena, "SO-DONE", total=5_000, delivery=TODAY - timedelta(days=2), status="delivered")
    _order(db_session, nena, "SO-TODAY", total=5_000, delivery=TODAY)
    [notice] = _build(db_session, company, "late_deliveries")
    assert notice.body.splitlines()[0] == "SO-LATE, Aling Nena Store: due Sun 27 Sep, 2 days late"
    # Next morning: SO-LATE is old news, SO-TODAY has just become late.
    [notice] = _build(db_session, company, "late_deliveries", now=NOW + timedelta(days=1))
    assert notice.body.splitlines()[:-1] == ["SO-TODAY, Aling Nena Store: due Tue 29 Sep, 1 day late"]


def test_tomorrows_orders_without_a_trip_are_flagged(db_session, company):
    nena = _customer(db_session, "Aling Nena Store")
    tomorrow = TODAY + timedelta(days=1)
    _order(db_session, nena, "SO-NOTRUCK", total=5_000, delivery=tomorrow)
    planned = _order(db_session, nena, "SO-PLANNED", total=5_000, delivery=tomorrow)
    truck = Truck(plate_number="ABC 1234")
    driver = Driver(name="Mang Tonyo")
    db_session.add_all([truck, driver])
    db_session.flush()
    db_session.add(
        DispatchTrip(trip_no="T-1", truck_id=truck.id, driver_id=driver.id, order_id=planned.id, dispatch_date=tomorrow)
    )
    db_session.flush()
    [notice] = _build(db_session, company, "no_truck", now=datetime.fromisoformat("2026-09-29T15:05+08:00"))
    assert notice.title == "No truck yet for tomorrow: 1 order"
    assert notice.body.splitlines()[0] == "SO-NOTRUCK, Aling Nena Store: ₱5,000"
