"""The locks around BossAdmin, "View as", vouchers, page release stages and who
may change a mill's plan (core/admin_guard.py, core/view_as.py,
services/vouchers.py, core/releases.py)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.core.admin_guard import require_admin_confirmed
from app.core.security import get_current_user, hash_password
from app.main import app
from app.models.activity import ActivityLog
from app.models.base import now_utc
from app.models.company import Company
from app.models.platform import AdminAuditLog
from app.models.subscription import Subscription, SubscriptionPlan
from app.models.user import User
from app.models.voucher import VoucherRedemption

PASSWORD = "Boss-Admin-Pass-2026"
NATIVE = {"X-Client-Type": "bearer", "User-Agent": "Electron/Test"}


@pytest.fixture
def real_confirmation():
    """Take away conftest's stand-in: the real confirmation is under test."""
    app.dependency_overrides.pop(require_admin_confirmed, None)


def _bossadmin(db_session, username: str = "boss.admin") -> User:
    admin = User(
        username=username,
        full_name="Platform Admin",
        password_hash=hash_password(PASSWORD),
        is_active=True,
        is_platform_admin=True,
    )
    db_session.add(admin)
    db_session.flush()
    return admin


def _sign_in(client, username: str = "boss.admin") -> dict:
    res = client.post("/api/auth/login", data={"username": username, "password": PASSWORD}, headers=NATIVE)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}", **NATIVE}


@pytest.fixture
def pro(db_session) -> SubscriptionPlan:
    plan = SubscriptionPlan(
        code="pro", name="Pro", features=["paddy"], is_active=True, monthly_price=2000, annual_price=20000
    )
    db_session.add(plan)
    db_session.flush()
    return plan


# ── confirm before changing ──────────────────────────────────────────────────


def test_bossadmin_reads_freely_but_changes_only_after_confirming(client, db_session, real_confirmation):
    _bossadmin(db_session)
    headers = _sign_in(client)

    assert client.get("/api/admin/pages", headers=headers).status_code == 200
    refused = client.put("/api/admin/pages/reports", json={"stage": "pro"}, headers=headers)
    assert refused.status_code == 403 and refused.json()["code"] == "confirm_required"

    wrong = client.post("/api/admin/confirm", json={"current_password": "not-it"}, headers=headers)
    assert wrong.status_code == 400 and wrong.json()["code"] == "confirm_failed"
    ok = client.post("/api/admin/confirm", json={"current_password": PASSWORD}, headers=headers)
    assert ok.status_code == 200 and ok.json()["confirmed_until"]

    assert client.put("/api/admin/pages/reports", json={"stage": "pro"}, headers=headers).status_code == 200

    # Another sign-in has to confirm for itself.
    other = _sign_in(client)
    again = client.put("/api/admin/pages/reports", json={"stage": "everyone"}, headers=other)
    assert again.status_code == 403 and again.json()["code"] == "confirm_required"

    actions = {row.action for row in db_session.query(AdminAuditLog).all()}
    assert {"auth.login", "admin.confirmed", "admin.change"} <= actions


def test_bossadmin_always_types_the_authenticator_code(db_session):
    from app.services.auth_service import AuthService

    admin = _bossadmin(db_session)
    assert AuthService._mfa_trusted(admin, ["any-trust-token"]) is False


# ── View as ──────────────────────────────────────────────────────────────────


def test_view_as_is_read_only_and_the_mill_can_see_it_happened(client, db_session, seed_owner, real_confirmation):
    _bossadmin(db_session)
    headers = _sign_in(client)
    client.post("/api/admin/confirm", json={"current_password": PASSWORD}, headers=headers)

    res = client.post("/api/admin/view-as", json={"user_id": str(seed_owner.id), "mode": "view"}, headers=headers)
    assert res.status_code == 200, res.text
    token = res.cookies.get("view_as")
    assert token
    viewing = {"Authorization": f"Bearer {token}", **NATIVE}

    me = client.get("/api/auth/me", headers=viewing).json()
    assert me["username"] == "owner"
    assert me["viewing_as"]["mode"] == "view"
    assert me["viewing_as"]["admin_username"] == "boss.admin"

    blocked = client.post("/api/feedback", json={"rating": 5, "reasons": ["saves_time"]}, headers=viewing)
    assert blocked.status_code == 403 and "read-only" in blocked.json()["detail"]

    visits = db_session.query(ActivityLog).filter(ActivityLog.action == "bossadmin.view_as").all()
    assert len(visits) == 1 and "boss.admin" in visits[0].detail
    assert db_session.query(AdminAuditLog).filter(AdminAuditLog.action == "view_as.start").count() == 1


def test_full_control_needs_two_factor_and_never_reaches_another_admin(
    client, db_session, seed_owner, real_confirmation
):
    other_admin = _bossadmin(db_session, username="second.admin")
    _bossadmin(db_session)
    headers = _sign_in(client)
    client.post("/api/admin/confirm", json={"current_password": PASSWORD}, headers=headers)

    full = client.post(
        "/api/admin/view-as",
        json={"user_id": str(seed_owner.id), "mode": "full", "current_password": PASSWORD},
        headers=headers,
    )
    assert full.status_code == 400 and "two-factor" in full.json()["detail"]

    nope = client.post("/api/admin/view-as", json={"user_id": str(other_admin.id), "mode": "view"}, headers=headers)
    assert nope.status_code == 404


# ── vouchers ─────────────────────────────────────────────────────────────────


def _as(user) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _ops(db_session) -> User:
    ops = User(username="ops", full_name="Ops", password_hash="x", is_active=True, is_platform_admin=True)
    db_session.add(ops)
    db_session.flush()
    return ops


def _other_mill_owner(db_session, seed_owner) -> User:
    company = Company(name="Another Mill", provisioned_at=now_utc())
    db_session.add(company)
    db_session.flush()
    owner = User(
        company_id=company.id,
        username="other.owner",
        full_name="Other Owner",
        password_hash=hash_password("Password123"),
        role_id=seed_owner.role_id,
        is_active=True,
    )
    db_session.add(owner)
    db_session.flush()
    return owner


def test_a_voucher_locked_to_a_mill_works_there_once_and_nowhere_else(client, db_session, seed_owner, pro):
    _as(_ops(db_session))
    made = client.post(
        "/api/admin/vouchers",
        json={
            "kind": "free_time",
            "plan_id": str(pro.id),
            "free_months": 1,
            "free_days": 5,
            "company_id": str(seed_owner.company_id),
        },
    )
    assert made.status_code == 201, made.text
    code = made.json()["code"]
    assert made.json()["max_uses"] == 1

    other = _other_mill_owner(db_session, seed_owner)
    _as(other)
    stranger = client.post("/api/billing/vouchers/redeem", json={"code": code, "current_password": "Password123"})
    assert stranger.status_code == 400 and stranger.json()["code"] == "voucher_not_yours"

    _as(seed_owner)
    no_proof = client.post("/api/billing/vouchers/redeem", json={"code": code})
    assert no_proof.status_code == 400 and no_proof.json()["code"] == "confirm_failed"

    used = client.post(
        "/api/billing/vouchers/redeem", json={"code": code.lower().replace("-", " "), "current_password": "Password123"}
    )
    assert used.status_code == 200, used.text
    sub = db_session.query(Subscription).filter(Subscription.company_id == seed_owner.company_id).one()
    db_session.refresh(sub)
    assert sub.plan_id == pro.id
    assert sub.expires_at > datetime.now(timezone.utc) + timedelta(days=30)

    twice = client.post("/api/billing/vouchers/redeem", json={"code": code, "current_password": "Password123"})
    assert twice.status_code == 400 and twice.json()["code"] == "voucher_used"
    assert db_session.query(VoucherRedemption).count() == 1


def test_a_discount_is_worked_out_by_the_server_and_counted_when_approved(client, db_session, seed_owner, pro):
    ops = _ops(db_session)
    _as(ops)
    code = client.post(
        "/api/admin/vouchers",
        json={"kind": "percent_off", "percent_off": 25, "plan_id": str(pro.id), "billing_interval": "monthly"},
    ).json()["code"]

    _as(seed_owner)
    check = client.post(
        "/api/billing/vouchers/check", json={"code": code, "plan_id": str(pro.id), "billing_interval": "monthly"}
    ).json()
    assert check["prices"]["PHP"] == {"price": 2000.0, "discount": 500.0, "total": 1500.0}
    wrong_interval = client.post(
        "/api/billing/upgrade-requests",
        json={
            "current_password": "Password123",
            "plan_id": str(pro.id),
            "billing_interval": "annual",
            "voucher_code": code,
        },
    )
    assert wrong_interval.status_code == 400 and wrong_interval.json()["code"] == "voucher_wrong_interval"

    req = client.post(
        "/api/billing/upgrade-requests",
        json={"current_password": "Password123", "plan_id": str(pro.id), "voucher_code": code},
    )
    assert req.status_code == 201, req.text
    assert req.json()["discount"] == 500.0 and req.json()["amount_due"] == 1500.0
    assert db_session.query(VoucherRedemption).count() == 0  # not until it's approved

    _as(ops)
    approved = client.post(f"/api/admin/upgrade-requests/{req.json()['id']}/approve", json={})
    assert approved.status_code == 200, approved.text
    use = db_session.query(VoucherRedemption).one()
    assert use.company_id == seed_owner.company_id and use.discount == Decimal("500.00")


def test_only_the_boss_changes_the_plan(client, db_session, seed_owner, pro):
    staff = User(
        company_id=seed_owner.company_id,
        username="mill.admin",
        full_name="Mill Admin",
        password_hash=hash_password("Password123"),
        role_id=2,  # "admin" (conftest seed_owner)
        is_active=True,
    )
    db_session.add(staff)
    db_session.flush()
    _as(staff)
    res = client.post("/api/billing/upgrade-requests", json={"current_password": "Password123", "plan_id": str(pro.id)})
    assert res.status_code == 403
    assert res.json()["detail"] == "Only the Boss can change the plan."


# ── page release stages ──────────────────────────────────────────────────────


def test_a_page_held_back_is_closed_until_its_stage_or_a_switch_reaches_the_mill(client, db_session, seed_owner):
    ops = _ops(db_session)
    _as(ops)
    assert client.put("/api/admin/pages/reports", json={"stage": "enterprise"}).status_code == 200

    _as(seed_owner)  # the seeded mill is on a plan whose code is "test"
    assert client.get("/api/auth/me").json()["access"]["reports"] == "none"

    _as(ops)
    switched = client.put(
        f"/api/admin/tenants/{seed_owner.company_id}/pages", json={"section": "reports", "value": "on"}
    )
    assert switched.status_code == 200, switched.text
    _as(seed_owner)
    db_session.expire_all()
    assert client.get("/api/auth/me").json()["access"]["reports"] != "none"

    _as(ops)
    assert client.put("/api/admin/pages/settings", json={"stage": "bossadmin"}).status_code == 404  # always on


def test_bossadmin_sees_when_people_were_last_here(client, db_session, seed_owner):
    _as(_ops(db_session))
    users = client.get("/api/admin/users").json()
    assert all("last_seen" in u for u in users)
    tenants = client.get("/api/admin/tenants").json()
    assert all("last_seen" in t for t in tenants)
