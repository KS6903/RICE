"""Platform upkeep: plan-ending reminders, purging spent sign-in records, the
emails for lockouts and upgrade requests, and the Redis budget warning."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import pytest
from pydantic import SecretStr

from app.core import config as cfg
from app.core.ratelimit import LockoutState
from app.models.auth_session import AuthSession
from app.models.company import Company
from app.models.notification import Notification
from app.models.password_reset import PasswordResetToken
from app.models.subscription import Subscription, SubscriptionPlan
from app.models.upgrade_request import UpgradeRequest
from app.models.user import User
from app.services import platform_emails, platform_jobs

MANILA = ZoneInfo("Asia/Manila")
TODAY = date(2026, 10, 5)


@pytest.fixture
def sent(monkeypatch):
    """Every email the platform would send, instead of sending it."""
    outbox: list[dict] = []
    monkeypatch.setattr(platform_emails, "send_account_email", lambda **m: outbox.append(m))
    return outbox


@pytest.fixture
def paid(db_session, seed_owner):
    company = db_session.get(Company, seed_owner.company_id)
    sub = db_session.query(Subscription).filter(Subscription.company_id == company.id).one()
    sub.plan.monthly_price = Decimal(2500)
    sub.plan.name = "Pro"
    db_session.flush()
    return company, sub


def _ends(days: int) -> datetime:
    return datetime.combine(TODAY + timedelta(days=days), datetime.min.time(), tzinfo=MANILA) + timedelta(hours=12)


# ── plan-ending reminders ────────────────────────────────────────────────────


@pytest.mark.parametrize("days,title", [(7, "Your Pro plan ends in 7 days"), (1, "Your Pro plan ends tomorrow")])
def test_owners_hear_a_week_and_a_day_before_a_plan_ends(db_session, seed_owner, paid, days, title):
    company, sub = paid
    sub.expires_at = _ends(days)
    db_session.flush()
    assert platform_jobs.remind_expiring(db_session, company, today=TODAY, zone=MANILA) == 1
    [notice] = db_session.query(Notification).filter(Notification.user_id == seed_owner.id).all()
    assert notice.title == title
    assert "moves to the Free plan" in notice.body
    assert notice.email_status == "pending"
    # The same day again adds nothing.
    assert platform_jobs.remind_expiring(db_session, company, today=TODAY, zone=MANILA) == 0


def test_no_reminder_on_other_days_or_for_the_free_plan(db_session, paid):
    company, sub = paid
    sub.expires_at = _ends(6)
    db_session.flush()
    assert platform_jobs.remind_expiring(db_session, company, today=TODAY, zone=MANILA) == 0
    sub.expires_at = _ends(7)
    sub.plan.monthly_price = Decimal(0)
    db_session.flush()
    assert platform_jobs.remind_expiring(db_session, company, today=TODAY, zone=MANILA) == 0


def test_a_trial_and_a_queued_plan_are_named(db_session, seed_owner, paid):
    company, sub = paid
    nxt = SubscriptionPlan(code="ent-x", name="Enterprise", features=[], monthly_price=Decimal(5000))
    db_session.add(nxt)
    db_session.flush()
    sub.status, sub.expires_at, sub.trial_ends_at, sub.queued_plan_id = "trial", None, _ends(1), nxt.id
    db_session.flush()
    platform_jobs.remind_expiring(db_session, company, today=TODAY, zone=MANILA)
    [notice] = db_session.query(Notification).filter(Notification.user_id == seed_owner.id).all()
    assert notice.title == "Your free trial of Pro ends tomorrow"
    assert "moves to the Enterprise plan you chose" in notice.body


# ── purging spent sign-in records ────────────────────────────────────────────


def test_spent_reset_links_and_long_dead_sessions_are_purged(db_session, seed_owner):
    now = datetime.now(timezone.utc)
    old, fresh = now - timedelta(days=40), now + timedelta(days=1)

    def token(**kw):
        return PasswordResetToken(user_id=seed_owner.id, token_hash=uuid.uuid4().hex, **kw)

    def session(**kw):
        return AuthSession(user_id=seed_owner.id, family_id=uuid.uuid4(), **kw)

    db_session.add_all(
        [
            token(expires_at=now - timedelta(days=2)),  # expired: goes
            token(expires_at=fresh, used_at=now - timedelta(days=2)),  # used: goes
            token(expires_at=fresh),  # live: stays
            session(expires_at=old),  # long expired: goes
            session(expires_at=now - timedelta(days=5), revoked_at=old),  # stays a month
            session(expires_at=fresh),  # live: stays
        ]
    )
    db_session.flush()
    assert platform_jobs.purge_auth_records(db_session, now=now) == (2, 1)


# ── emails ───────────────────────────────────────────────────────────────────


def test_a_lockout_emails_the_account_holder(auth_client, seed_owner, sent, monkeypatch):
    from app.services import auth_service

    monkeypatch.setattr(auth_service, "login_lockout", lambda u: LockoutState(False, False, 0))
    monkeypatch.setattr(auth_service, "register_login_failure", lambda u: LockoutState(True, False, 900))
    res = auth_client.post("/api/auth/login", data={"username": "owner", "password": "wrong-password"})
    assert res.status_code == 429
    [mail] = sent
    assert mail["to"] == "owner@test.local"
    assert "about 15 minutes" in mail["text"]


def test_a_permanent_lockout_points_to_the_reset(seed_owner, sent):
    platform_emails.account_locked(seed_owner, LockoutState(locked=True, permanent=True, retry_after=0))
    assert "until the password is reset" in sent[0]["text"]


def test_a_failed_email_never_fails_the_action(seed_owner, monkeypatch):
    def boom(**m):
        raise OSError("smtp down")

    monkeypatch.setattr(platform_emails, "send_account_email", boom)
    assert platform_emails.account_locked(seed_owner, LockoutState(True, False, 60)) is False


def _platform_admin(db_session, seed_owner) -> User:
    admin = User(
        username="platformadmin",
        email="ops@test.local",
        password_hash=seed_owner.password_hash,
        full_name="Ops",
        is_active=True,
        is_platform_admin=True,
    )
    db_session.add(admin)
    db_session.flush()
    return admin


def test_platform_admins_hear_of_a_new_upgrade_request(auth_client, db_session, seed_owner, sent):
    _platform_admin(db_session, seed_owner)
    pro = SubscriptionPlan(code="pro-y", name="Pro Y", features=[], monthly_price=Decimal(2000), is_active=True)
    db_session.add(pro)
    db_session.flush()
    res = auth_client.post("/api/billing/upgrade-requests", json={"plan_id": str(pro.id), "note": "Need reports"})
    assert res.status_code == 201, res.text
    [mail] = sent
    assert mail["to"] == "ops@test.local"
    assert mail["subject"] == "Upgrade request: Test Mill wants Pro Y"
    assert "Need reports" in mail["text"]


@pytest.mark.parametrize("action,word", [("approve", "approved"), ("reject", "not approved")])
def test_the_requester_hears_the_decision(auth_client, db_session, seed_owner, sent, action, word):
    from app.core.security import get_current_user
    from app.main import app

    pro = SubscriptionPlan(code=f"pro-{action}", name="Pro Z", features=[], is_active=True)
    db_session.add(pro)
    db_session.flush()
    req = UpgradeRequest(
        company_id=seed_owner.company_id,
        requested_plan_id=pro.id,
        requested_by=seed_owner.id,
        status="pending",
        request_type="upgrade",
    )
    db_session.add(req)
    db_session.flush()
    ops = _platform_admin(db_session, seed_owner)
    app.dependency_overrides[get_current_user] = lambda: ops  # the admin decides
    assert auth_client.post(f"/api/admin/upgrade-requests/{req.id}/{action}", json={}).status_code == 200
    [mail] = [m for m in sent if m["to"] == "owner@test.local"]
    assert f"was {word}" in mail["text"]


# ── the Redis budget ─────────────────────────────────────────────────────────


@pytest.fixture
def upstash(monkeypatch):
    monkeypatch.setattr(cfg.settings, "UPSTASH_API_EMAIL", "ops@test.local", raising=False)
    monkeypatch.setattr(cfg.settings, "UPSTASH_API_KEY", SecretStr("k"), raising=False)
    monkeypatch.setattr(cfg.settings, "UPSTASH_DATABASE_ID", "db-1", raising=False)
    monkeypatch.setattr(cfg.settings, "UPSTASH_MONTHLY_REQUEST_LIMIT", 500_000, raising=False)
    usage = {"total_monthly_requests": 0}
    monkeypatch.setattr(
        httpx, "get", lambda url, **kw: httpx.Response(200, json=usage, request=httpx.Request("GET", url))
    )
    return usage


def test_the_redis_budget_does_nothing_unconfigured(db_session):
    assert platform_jobs.redis_budget(db_session, now=datetime.now(timezone.utc)) == "Upstash API not configured"


def test_admins_are_warned_once_a_month_per_level(db_session, seed_owner, upstash, sent):
    _platform_admin(db_session, seed_owner)
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    upstash["total_monthly_requests"] = 200_000
    assert platform_jobs.redis_budget(db_session, now=now) == "200,000 of 500,000 requests this month (40%)"
    assert sent == []
    upstash["total_monthly_requests"] = 360_000
    platform_jobs.redis_budget(db_session, now=now)
    platform_jobs.redis_budget(db_session, now=now + timedelta(days=1))
    assert [m["subject"] for m in sent] == ["Redis at 70% of this month's quota"]
    upstash["total_monthly_requests"] = 460_000
    platform_jobs.redis_budget(db_session, now=now + timedelta(days=2))
    assert [m["subject"] for m in sent][-1] == "Redis at 90% of this month's quota"
    assert len(sent) == 2
