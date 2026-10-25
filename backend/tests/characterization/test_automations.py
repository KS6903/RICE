"""Automations: Enterprise-only, managed by owners and admins, each run once
per schedule, and the morning summary adds up yesterday correctly."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.automations.engine import run_due_automations
from app.core.tenancy import set_search_path
from app.jobs.registry import JobContext
from app.models.automation import AutomationRule
from app.models.company import Company
from app.models.costs import Expense
from app.models.job_run import JobRun
from app.models.milling import MillingBatch, MillingBatchOutput
from app.models.notification import Notification
from app.models.paddy import PalayPurchase, PalayPurchaseItem
from app.models.sales import Invoice, Payment, SalesOrder
from app.models.subscription import Subscription
from app.services.notification_service import notify

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
    recipes = auth_client.get("/api/automations/").json()["recipes"]
    [digest] = [r for r in recipes if r["code"] == "owner_digest"]
    assert digest["code"] == "owner_digest"
    assert digest["enabled"] is False
    assert digest["params"] == {"send_at": "06:00", "ai_advice": False, "email": True}
    assert [f["name"] for f in digest["fields"]] == ["send_at", "ai_advice", "email"]
    assert digest["ai_optional"] is True


def test_every_recipe_loads_with_its_defaults(auth_client):
    from app.automations.recipes import RECIPES

    recipes = auth_client.get("/api/automations/").json()["recipes"]
    assert [r["code"] for r in recipes] == list(RECIPES)
    for r in recipes:
        assert set(r["params"]) == {f["name"] for f in r["fields"]}, r["code"]


def test_the_page_says_when_scheduled_runs_have_stopped(auth_client, db_session, seed_owner):
    health = auth_client.get("/api/automations/").json()["health"]
    assert health == {
        "scheduler_running": False,
        "last_tick": None,
        "emails": {"failed": 0, "retrying": 0},
    }
    db_session.add(
        JobRun(
            job="automations.run",
            company_id=seed_owner.company_id,
            run_key="tick-now",
            status="succeeded",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
    )
    db_session.commit()
    assert auth_client.get("/api/automations/").json()["health"]["scheduler_running"] is True


def test_the_page_counts_automation_emails_that_never_arrived(auth_client, db_session, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    set_search_path(db_session, company.schema_name)
    for key, status, attempts in (("a", "failed", 4), ("b", "pending", 1), ("c", "pending", 0), ("d", "sent", 1)):
        notify(
            db_session,
            company_id=company.id,
            user_ids=[seed_owner.id],
            kind="automation.due_reminders",
            title=key,
            dedupe_key=key,
            email=True,
        )
        db_session.query(Notification).filter(Notification.dedupe_key == key).update(
            {"email_status": status, "email_attempts": attempts}
        )
    notify(
        db_session,
        company_id=company.id,
        user_ids=[seed_owner.id],
        kind="subscription.expiring",
        title="x",
        dedupe_key="x",
    )
    db_session.commit()
    emails = auth_client.get("/api/automations/").json()["health"]["emails"]
    assert emails == {"failed": 1, "retrying": 1}


def test_the_owner_switches_it_on(auth_client, seed_owner):
    res = auth_client.put(
        "/api/automations/owner_digest",
        json={"enabled": True, "params": {"send_at": "05:30", "email": False}, "recipients": [str(seed_owner.id)]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["enabled"] is True
    assert body["params"] == {"send_at": "05:30", "ai_advice": False, "email": False}
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


def test_send_test_reaches_only_the_person_who_asked(auth_client, db_session, seed_owner, monkeypatch):
    sent_to: list[str] = []
    monkeypatch.setattr("app.core.mailer.Mailer.send", lambda self, **kw: sent_to.append(kw["to"]) or True)
    # Emailed straight away: on a server whose jobs runner never ticks, it would never go.
    assert auth_client.post("/api/automations/owner_digest/test").json() == {
        "sent": 1,
        "email": "sent",
        "to": "owner@test.local",
    }
    assert sent_to == ["owner@test.local"]
    titles = [n["title"] for n in auth_client.get("/api/notifications/").json()["items"]]
    assert len(titles) == 1 and titles[0].startswith("Yesterday at ")


def test_send_test_says_when_email_is_not_set_up(auth_client):
    # No SMTP in tests: the notice is under the bell, and the page says why no email came.
    assert auth_client.post("/api/automations/owner_digest/test").json() == {
        "sent": 1,
        "email": "not_set_up",
        "to": None,
    }
