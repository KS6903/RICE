"""Automations: Enterprise-only, managed by owners and admins, each run once
per schedule, and the morning summary adds up yesterday correctly."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.engine import run_due_automations
from app.jobs.registry import JobContext
from app.models.automation import AutomationRule
from app.models.company import Company
from app.models.costs import Expense
from app.models.milling import MillingBatch, MillingBatchOutput
from app.models.notification import Notification
from app.models.paddy import PalayPurchase, PalayPurchaseItem
from app.models.sales import Invoice, Payment, SalesOrder
from app.models.subscription import Subscription

MANILA = ZoneInfo("Asia/Manila")
# Tuesday 06:05 in Manila; "yesterday" is Monday 28 Sep.
NOW = datetime.fromisoformat("2026-09-29T06:05+08:00")
YESTERDAY = date(2026, 9, 28)


def _run(db_session, company, now=NOW) -> str:
    return run_due_automations(JobContext(db=db_session, now=now, zone=MANILA, run_key="tick", company=company))


def _enable_digest(db_session, company, **params) -> AutomationRule:
    rule = AutomationRule(company_id=company.id, recipe="owner_digest", enabled=True, params=params, recipients=[])
    db_session.add(rule)
    db_session.commit()
    return rule


def _notices(db_session, user_id) -> list[Notification]:
    db_session.expire_all()
    return db_session.query(Notification).filter(Notification.user_id == user_id).all()


# ── gates ────────────────────────────────────────────────────────────────────


def test_tenants_without_enterprise_get_402(make_auth_client):
    client = make_auth_client(features=["reports_advanced"], username="probasic")
    assert client.get("/api/automations/").status_code == 402


def test_roles_without_the_section_get_403(make_auth_client):
    client = make_auth_client(features=["automations"], username="till", role_name="cashier")
    assert client.get("/api/automations/").status_code == 403


def test_accountants_can_look_but_not_change(make_auth_client):
    client = make_auth_client(features=["automations"], username="books", role_name="accountant")
    assert client.get("/api/automations/").status_code == 200
    res = client.put("/api/automations/owner_digest", json={"enabled": True, "params": {}, "recipients": []})
    assert res.status_code == 403


# ── settings ─────────────────────────────────────────────────────────────────


def test_the_owner_sees_the_morning_summary_with_its_defaults(auth_client):
    digest = auth_client.get("/api/automations/").json()["recipes"][0]
    assert digest["code"] == "owner_digest"
    assert digest["enabled"] is False
    assert digest["params"] == {"send_at": "06:00", "email": True}
    assert [f["name"] for f in digest["fields"]] == ["send_at", "email"]


def test_every_recipe_loads_with_its_defaults(auth_client):
    from app.automations.recipes import RECIPES

    recipes = auth_client.get("/api/automations/").json()["recipes"]
    assert [r["code"] for r in recipes] == list(RECIPES)
    for r in recipes:
        assert set(r["params"]) == {f["name"] for f in r["fields"]}, r["code"]


def test_the_owner_switches_it_on(auth_client, seed_owner):
    res = auth_client.put(
        "/api/automations/owner_digest",
        json={"enabled": True, "params": {"send_at": "05:30", "email": False}, "recipients": [str(seed_owner.id)]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["enabled"] is True
    assert body["params"] == {"send_at": "05:30", "email": False}
    assert body["effective_recipients"] == [str(seed_owner.id)]


@pytest.mark.parametrize("send_at", ["13:00", "03:00", "six"])
def test_a_send_time_outside_the_morning_is_refused(auth_client, send_at):
    res = auth_client.put(
        "/api/automations/owner_digest", json={"enabled": True, "params": {"send_at": send_at}, "recipients": []}
    )
    assert res.status_code == 422


def test_someone_who_cannot_see_reports_cannot_receive_it(auth_client, db_session, seed_owner):
    from app.models.user import Role, User

    cashier_role = db_session.query(Role).filter(Role.name == "cashier").first()
    if cashier_role is None:
        cashier_role = Role(id=99, name="cashier")
        db_session.add(cashier_role)
        db_session.flush()
    cashier = User(
        company_id=seed_owner.company_id,
        branch_id=seed_owner.branch_id,
        username="till1",
        email="till1@test.local",
        password_hash=seed_owner.password_hash,
        full_name="Till",
        role_id=cashier_role.id,
        is_active=True,
    )
    db_session.add(cashier)
    db_session.commit()
    res = auth_client.put(
        "/api/automations/owner_digest", json={"enabled": True, "params": {}, "recipients": [str(cashier.id)]}
    )
    assert res.status_code == 400
    assert "no access to reports" in res.json()["detail"]


def test_unknown_automations_are_404(auth_client):
    assert auth_client.put("/api/automations/nope", json={"enabled": True}).status_code == 404


# ── running ──────────────────────────────────────────────────────────────────


def test_the_summary_is_due_from_its_time_until_noon(db_session, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    _enable_digest(db_session, company, send_at="06:00")
    assert (
        _run(db_session, company, datetime.fromisoformat("2026-09-29T05:50+08:00")) == "0 automation(s) ran, 0 failed"
    )
    assert (
        _run(db_session, company, datetime.fromisoformat("2026-09-29T12:10+08:00")) == "0 automation(s) ran, 0 failed"
    )
    assert _run(db_session, company) == "1 automation(s) ran, 0 failed"
    # The same morning again: already done.
    assert _run(db_session, company) == "0 automation(s) ran, 0 failed"
    assert len(_notices(db_session, seed_owner.id)) == 1


def test_the_summary_adds_up_yesterday(db_session, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    purchase = PalayPurchase(reference_no="PP-T1", purchase_date=YESTERDAY, status="completed")
    db_session.add(purchase)
    db_session.flush()
    # 1,050 kg gross less 50 kg tare = 1,000 kg = 20 cavans at 1,250.
    db_session.add(
        PalayPurchaseItem(purchase_id=purchase.id, gross_weight_kg=1050, tare_weight_kg=50, price_per_cavan=1250)
    )
    db_session.add(PalayPurchase(reference_no="PP-T0", purchase_date=date(2026, 9, 27), status="completed"))
    batch = MillingBatch(
        batch_no="MB-T1",
        start_datetime=datetime.fromisoformat("2026-09-28T08:00+08:00"),
        end_datetime=datetime.fromisoformat("2026-09-28T15:00+08:00"),
        status="completed",
    )
    db_session.add(batch)
    db_session.flush()
    db_session.add_all(
        [
            MillingBatchOutput(batch_id=batch.id, output_type="milled_rice", output_weight_kg=640),
            MillingBatchOutput(batch_id=batch.id, output_type="ipa", output_weight_kg=200),
            SalesOrder(order_no="SO-T1", order_date=YESTERDAY, total_amount=Decimal(48000), status="confirmed"),
            SalesOrder(order_no="SO-T2", order_date=YESTERDAY, total_amount=Decimal(9999), status="draft"),
            Payment(payment_date=YESTERDAY, amount=Decimal(30000), method="cash", created_at=NOW),
            Expense(expense_date=YESTERDAY, amount=Decimal(5200)),
            Invoice(
                invoice_no="INV-T1",
                invoice_date=date(2026, 8, 1),
                total_amount=Decimal(10000),
                paid_amount=Decimal(2500),
                status="overdue",
            ),
        ]
    )
    db_session.commit()
    _enable_digest(db_session, company)

    _run(db_session, company)
    [notice] = _notices(db_session, seed_owner.id)
    assert notice.title == f"Yesterday at {company.name} ({YESTERDAY:%a %d %b})"
    assert notice.body.splitlines() == [
        "Palay bought: 1,000 kg for ₱25,000",
        "Rice milled: 640 kg",
        "Sales: ₱48,000. Collected: ₱30,000",
        "Expenses: ₱5,200",
        "Needs attention: 1 overdue invoice, ₱7,500 unpaid",
    ]
    assert notice.link == "/reports"
    assert notice.email_status == "pending"


def test_rules_pause_when_the_tenant_leaves_enterprise(db_session, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    _enable_digest(db_session, company)
    plan = db_session.query(Subscription).filter(Subscription.company_id == company.id).one().plan
    plan.features = [f for f in plan.features if f != "automations"]
    db_session.commit()
    assert _run(db_session, company).endswith("paused: the plan doesn't include automations")
    assert _notices(db_session, seed_owner.id) == []
    # The rule is kept, switched on, for when they come back.
    assert db_session.query(AutomationRule).one().enabled is True


def test_send_test_reaches_only_the_person_who_asked(auth_client, db_session, seed_owner):
    assert auth_client.post("/api/automations/owner_digest/test").json() == {"sent": 1}
    titles = [n["title"] for n in auth_client.get("/api/notifications/").json()["items"]]
    assert len(titles) == 1 and titles[0].startswith("Yesterday at ")
