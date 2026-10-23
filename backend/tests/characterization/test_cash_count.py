"""The cash drawer, reconciled: opening cash plus the day's cash payments, less
what was paid out, against what's counted. A difference beyond the allowance
goes to the owner at once and waits for review."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.base import RecipeContext
from app.automations.recipes import RECIPES
from app.core.security import get_current_user
from app.core.timezones import tenant_zone
from app.main import app
from app.models.automation import AutomationRule
from app.models.cash import CashCount
from app.models.company import Company
from app.models.notification import Notification
from app.models.sales import Invoice, Payment
from app.models.user import Role, User

MANILA = ZoneInfo("Asia/Manila")


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


def _today(company) -> date:
    return datetime.now(tenant_zone(company.timezone)).date()


def _cashier(db_session, owner) -> User:
    role = Role(id=5, name="cashier")
    db_session.add(role)
    db_session.flush()
    user = User(
        company_id=owner.company_id,
        branch_id=owner.branch_id,
        username="till",
        email="till@test.local",
        password_hash=owner.password_hash,
        full_name="Tess Till",
        role_id=role.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _paid(db_session, day, amount, method, by):
    inv = Invoice(invoice_no=f"INV-{amount}-{method}", invoice_date=day, total_amount=Decimal(amount), status="paid")
    db_session.add(inv)
    db_session.flush()
    db_session.add(
        Payment(
            invoice_id=inv.id,
            payment_date=day,
            amount=Decimal(amount),
            method=method,
            received_by=by.id,
            created_at=datetime.now(MANILA),
        )
    )
    db_session.flush()


def _guard(db_session, company, tolerance=100):
    db_session.add(
        AutomationRule(
            company_id=company.id, recipe="cash_count", enabled=True, params={"tolerance": tolerance}, recipients=[]
        )
    )
    db_session.commit()


def test_a_short_drawer_reaches_the_owner_and_waits_for_review(auth_client, db_session, company, seed_owner):
    today = _today(company)
    till = _cashier(db_session, seed_owner)
    db_session.add(
        CashCount(
            company_id=company.id, count_date=today - timedelta(days=1), counted=Decimal(5_500), taken_out=Decimal(500)
        )
    )
    _paid(db_session, today, 12_000, "cash", till)
    _paid(db_session, today, 8_000, "gcash", till)  # not cash: not in the drawer
    _guard(db_session, company)

    page = auth_client.get("/api/cash/").json()
    assert page["today"]["opening"] == 5_000  # yesterday's count less what was banked
    assert page["today"]["cash_in"] == 12_000
    assert page["today"]["cash_received"] == [{"who": "Tess Till", "amount": 12_000}]

    app.dependency_overrides[get_current_user] = lambda: till
    res = auth_client.post("/api/cash/", json={"counted": "14500", "cash_out": "2000", "note": "Paid the driver."})
    assert res.status_code == 200, res.text
    count = res.json()
    # 5,000 + 12,000 - 2,000 = 15,000 expected; 14,500 counted.
    assert (count["expected"], count["difference"], count["needs_review"]) == (15_000, -500, True)

    db_session.expire_all()
    [notice] = db_session.query(Notification).all()  # to the owner, not to the cashier who counted
    assert notice.user_id == seed_owner.id
    assert notice.title == f"Cash drawer short by ₱500 on {today:%a %d %b}"
    assert "Counted ₱14,500 by Tess Till." in notice.body
    assert "Their note: Paid the driver." in notice.body

    res = auth_client.post(f"/api/cash/{count['id']}/review", json={"note": "Found it"})
    assert res.status_code == 403  # a cashier can't clear their own difference
    app.dependency_overrides[get_current_user] = lambda: seed_owner
    res = auth_client.post(f"/api/cash/{count['id']}/review", json={"note": "₱500 change given, receipt found."})
    assert res.json()["needs_review"] is False and res.json()["reviewed_by"] == "Test Owner"


def test_a_small_difference_needs_nothing(auth_client, db_session, company, seed_owner):
    _guard(db_session, company, tolerance=100)
    res = auth_client.post("/api/cash/", json={"counted": "50", "opening": "0"})
    assert res.json()["difference"] == 50 and res.json()["needs_review"] is False
    db_session.expire_all()
    assert db_session.query(Notification).count() == 0


def test_correcting_a_count_replaces_it(auth_client, db_session, company):
    auth_client.post("/api/cash/", json={"counted": "1000", "opening": "0"})
    auth_client.post("/api/cash/", json={"counted": "1200", "opening": "0"})
    db_session.expire_all()
    [count] = db_session.query(CashCount).all()
    assert count.counted == Decimal(1200)


def test_the_evening_reminder_goes_only_when_nobody_counted(db_session, company):
    recipe = RECIPES["cash_count"]
    now = datetime.now(MANILA)
    ctx = RecipeContext(db=db_session, company=company, now=now, zone=MANILA)
    [notice] = recipe.build(ctx, recipe.params())
    assert notice.title.startswith("Count the cash drawer for")
    db_session.add(CashCount(company_id=company.id, count_date=ctx.local_today, counted=Decimal(0)))
    db_session.flush()
    assert recipe.build(ctx, recipe.params()) == []


def test_cash_counts_need_the_pro_feature_and_sales_access(make_auth_client):
    assert make_auth_client(features=["sales"], username="basic").get("/api/cash/").status_code == 402
    floor = make_auth_client(features=["cash_count"], username="floor", role_name="mill_operator")
    assert floor.get("/api/cash/").status_code == 403
