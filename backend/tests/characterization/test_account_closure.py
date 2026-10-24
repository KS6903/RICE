"""Characterization: the Boss pauses the mill's account or asks for it to be deleted.

A closed account signs everyone out and keeps staff out. The Boss can still
sign in, to reopen it or take its data: a pause for as long as they like, a
deletion request for the export window. Nothing open with Oraiza (a plan
request, unpaid fees, paid time) may be left behind.
"""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models.base import now_utc
from app.models.company import Company
from app.models.subscription import Subscription, SubscriptionPlan
from app.models.upgrade_request import UpgradeRequest
from app.models.user import User

BEARER = {"X-Client-Type": "bearer"}


def _login(client, username="owner"):
    res = client.post("/api/auth/login", data={"username": username, "password": "Password123"}, headers=BEARER)
    client.cookies.clear()
    return res


def _signed_in(client, username="owner") -> dict:
    res = _login(client, username)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _add_staff(db_session, owner) -> None:
    db_session.add(
        User(
            company_id=owner.company_id,
            branch_id=owner.branch_id,
            username="staff",
            password_hash=hash_password("Password123"),
            full_name="Mill Admin",
            role_id=2,  # admin: a manager, but not the Boss
            is_active=True,
        )
    )
    db_session.flush()


def _close(client, headers, mode="pause", **over):
    body = {"mode": mode, "current_password": "Password123", **over}
    return client.post("/api/auth/account/close", json=body, headers=headers)


def _company(db_session, owner) -> Company:
    company = db_session.get(Company, owner.company_id)
    db_session.refresh(company)
    return company


def test_a_pause_signs_everyone_out_and_keeps_staff_out(client, db_session, seed_owner):
    _add_staff(db_session, seed_owner)
    staff = _signed_in(client, "staff")
    boss = _signed_in(client)

    res = _close(client, boss)
    assert res.status_code == 200, res.text
    assert res.json()["state"] == "paused"
    assert client.get("/api/auth/me", headers=boss).status_code == 401
    assert client.get("/api/auth/me", headers=staff).status_code == 401

    refused = _login(client, "staff")
    assert refused.status_code == 403
    assert "paused by its Boss" in refused.json()["detail"]


def test_the_boss_comes_back_to_take_the_data_or_reopen(client, db_session, seed_owner):
    _add_staff(db_session, seed_owner)
    assert _close(client, _signed_in(client)).status_code == 200

    boss = _signed_in(client)
    assert client.get("/api/auth/me", headers=boss).json()["account"]["state"] == "paused"
    # Everything is shut but the mill's data.
    assert client.get("/api/costs/categories", headers=boss).status_code == 403
    assert client.get("/api/backup/status", headers=boss).status_code == 200

    res = client.post("/api/auth/account/reopen", headers=boss)
    assert res.status_code == 200, res.text
    assert res.json()["state"] == "open"
    assert client.get("/api/costs/categories", headers=boss).status_code == 200
    assert _login(client, "staff").status_code == 200


def test_asking_for_deletion_takes_the_mills_name(client, db_session, seed_owner):
    boss = _signed_in(client)
    wrong = _close(client, boss, mode="delete", confirm_name="Another Mill")
    assert wrong.status_code == 422
    assert _company(db_session, seed_owner).is_active

    res = _close(client, boss, mode="delete", confirm_name="  test mill ")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["state"] == "deletion_requested"
    company = _company(db_session, seed_owner)
    assert company.closed_by == seed_owner.id
    until = datetime.fromisoformat(body["export_until"])
    assert until == company.deletion_requested_at + timedelta(days=30)


def test_after_the_export_window_the_boss_cannot_come_back(client, db_session, seed_owner):
    assert _close(client, _signed_in(client), mode="delete", confirm_name="Test Mill").status_code == 200
    company = _company(db_session, seed_owner)
    company.deletion_requested_at = now_utc() - timedelta(days=31)
    db_session.flush()

    refused = _login(client)
    assert refused.status_code == 403
    assert "being deleted, as you asked" in refused.json()["detail"]


def test_a_wrong_password_closes_nothing(client, db_session, seed_owner):
    res = _close(client, _signed_in(client), current_password="not-it")
    assert res.status_code == 400
    assert res.json()["code"] == "confirm_failed"
    assert _company(db_session, seed_owner).is_active


def test_only_the_boss_can_close_the_account(client, db_session, seed_owner):
    _add_staff(db_session, seed_owner)
    assert _close(client, _signed_in(client, "staff")).status_code == 403


def _paid(db_session, owner, *, status="active", expires_in_days=None) -> None:
    sub = db_session.query(Subscription).filter(Subscription.company_id == owner.company_id).one()
    sub.plan.monthly_price = Decimal("999")
    sub.status = status
    sub.expires_at = now_utc() + timedelta(days=expires_in_days) if expires_in_days is not None else None
    db_session.flush()


@pytest.mark.parametrize(
    ("setup", "code", "said"),
    [
        (lambda db, o: _paid(db, o), "paid_time", "still running"),
        (lambda db, o: _paid(db, o, expires_in_days=20), "paid_time", "is paid until"),
        (lambda db, o: _paid(db, o, status="past_due"), "unpaid", "fees still unpaid"),
    ],
)
def test_open_dealings_with_oraiza_stop_it(client, db_session, seed_owner, setup, code, said):
    setup(db_session, seed_owner)
    boss = _signed_in(client)
    blockers = client.get("/api/auth/account/closure", headers=boss).json()["blockers"]
    assert code in [b["code"] for b in blockers]

    res = _close(client, boss)
    assert res.status_code == 409
    assert res.json()["code"] == "account_has_dealings"
    assert said in res.json()["detail"]
    assert _company(db_session, seed_owner).is_active


def test_a_plan_request_under_review_stops_it(client, db_session, seed_owner):
    plan = SubscriptionPlan(code="pro-test", name="Pro Test", monthly_price=Decimal("2499"))
    db_session.add(plan)
    db_session.flush()
    db_session.add(UpgradeRequest(company_id=seed_owner.company_id, requested_plan_id=plan.id, status="pending"))
    db_session.flush()

    res = _close(client, _signed_in(client))
    assert res.status_code == 409
    assert "Pro Test plan is still being reviewed" in res.json()["detail"]
