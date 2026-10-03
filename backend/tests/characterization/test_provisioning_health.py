"""Tenant setup retries with back-off and never spins; an admin can retry it,
and the Worker is told to start at once; readiness and the health watch see
schema drift, Redis and stuck or failed tenants."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

import provision_pending_tenants as pp
from app.core import health, provisioning
from app.models.company import Company
from app.services import platform_emails, platform_jobs

NOW = datetime(2026, 10, 5, 3, 0, tzinfo=timezone.utc)


def _queued(db_session, name="Queued Mill", **kw) -> Company:
    company = Company(name=name, provisioning_requested_at=kw.pop("requested_at", NOW - timedelta(minutes=5)), **kw)
    db_session.add(company)
    db_session.flush()
    return company


# ── retries and back-off ─────────────────────────────────────────────────────


def test_a_failure_backs_off_further_each_time_then_stops(db_session):
    company = _queued(db_session)
    pauses = []
    for _ in range(provisioning.MAX_ATTEMPTS):
        assert provisioning.state(company) in ("queued", "retrying")
        provisioning.record_failure(company, now=NOW, message="boom")
        pauses.append(company.provisioning_next_attempt_at - NOW)
    assert pauses == [
        timedelta(minutes=1),
        timedelta(minutes=5),
        timedelta(minutes=15),
        timedelta(hours=1),
        timedelta(hours=1),
    ]
    assert provisioning.state(company) == "failed"


def test_only_due_tenants_are_picked(db_session):
    ready = _queued(db_session, "Ready")
    waiting = _queued(
        db_session, "Waiting", provisioning_attempts=1, provisioning_next_attempt_at=NOW + timedelta(minutes=3)
    )
    spent = _queued(db_session, "Spent", provisioning_attempts=provisioning.MAX_ATTEMPTS)
    done = _queued(db_session, "Done", provisioned_at=NOW)
    picked = {c.id for c in db_session.query(Company).filter(provisioning.due(NOW))}
    assert ready.id in picked
    assert not picked & {waiting.id, spent.id, done.id}


@pytest.fixture
def provisioner(db_session, monkeypatch):
    """The provisioner script, on the test's connection."""
    connection = db_session.connection()
    monkeypatch.setattr(
        pp, "ProvisionerSessionLocal", lambda: Session(bind=connection, join_transaction_mode="create_savepoint")
    )
    monkeypatch.setattr(pp, "now_utc", lambda: NOW)
    monkeypatch.setattr("sys.argv", ["provision_pending_tenants.py"])
    return pp


def test_a_failed_tenant_is_counted_and_the_run_exits_1(db_session, provisioner, monkeypatch):
    company = _queued(db_session)
    monkeypatch.setattr(pp, "provision_tenant", lambda c, db: (_ for _ in ()).throw(RuntimeError("DDL failed")))
    assert provisioner.main() == 1
    db_session.expire_all()
    company = db_session.get(Company, company.id)
    assert (company.provisioning_attempts, company.provisioning_next_attempt_at) == (1, NOW + timedelta(minutes=1))
    assert company.provisioning_error.startswith("Provisioning failed")


def test_an_unreachable_database_never_spins(provisioner, monkeypatch):
    calls = []

    def down():
        calls.append(1)
        raise ConnectionError("database down")

    monkeypatch.setattr(pp, "ProvisionerSessionLocal", down)
    assert provisioner.main() == 1
    assert len(calls) == 1  # it gave up the pass instead of retrying in a loop


def test_a_clean_run_exits_0(db_session, provisioner, monkeypatch):
    company = _queued(db_session)
    built = []
    monkeypatch.setattr(pp, "provision_tenant", lambda c, db: (built.append(c.id), setattr(c, "provisioned_at", NOW)))
    assert provisioner.main() == 0
    assert built == [company.id]


# ── the admin's Retry, and the Worker's cue ──────────────────────────────────


def test_an_admin_retry_clears_the_failures_and_cues_the_worker(admin_client, db_session):
    company = _queued(
        db_session, provisioning_attempts=provisioning.MAX_ATTEMPTS, provisioning_error="Provisioning failed"
    )
    res = admin_client.post(f"/api/admin/tenants/{company.id}/provisioning/retry")
    assert res.status_code == 200, res.text
    assert res.headers.get(provisioning.QUEUED_HEADER) == "1"
    assert (res.json()["state"], res.json()["attempts"], res.json()["error"]) == ("queued", 0, None)
    listed = admin_client.get("/api/admin/tenants").json()
    [row] = [t for t in listed if t["id"] == str(company.id)]
    assert row["provisioning"]["state"] == "queued"


def test_retrying_a_tenant_that_is_set_up_is_refused(admin_client, db_session):
    company = _queued(db_session, provisioned_at=NOW)
    assert admin_client.post(f"/api/admin/tenants/{company.id}/provisioning/retry").status_code == 409


def test_ordinary_responses_carry_no_cue(client):
    assert provisioning.QUEUED_HEADER not in client.get("/api/health").headers


# ── readiness and the health watch ───────────────────────────────────────────


def _stamp(db_session, *revisions):
    db_session.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) PRIMARY KEY)"))
    db_session.execute(text("DELETE FROM alembic_version"))
    for rev in revisions:
        db_session.execute(text("INSERT INTO alembic_version VALUES (:r)"), {"r": rev})
    db_session.flush()


def test_ready_only_when_the_schema_matches_the_code(client, db_session):
    _stamp(db_session, "009_automations_feature")
    res = client.get("/api/health/ready")
    assert res.status_code == 503
    assert res.json()["checks"]["schema"] is False
    assert set(res.json()["checks"]) == {"database", "schema", "redis", "provisioning"}
    _stamp(db_session, *health.code_heads())
    res = client.get("/api/health/ready")
    assert res.status_code == 200 and res.json()["ready"] is True


def test_stuck_and_failed_setups_are_reported(db_session):
    _stamp(db_session, *health.code_heads())
    _queued(db_session, "Stuck", requested_at=NOW - timedelta(minutes=45))
    checks = health.check(db_session, now=NOW)["checks"]
    assert checks["provisioning"]["ok"] is False
    assert checks["provisioning"]["oldest_waiting_minutes"] == 45


def test_the_health_watch_emails_each_problem_once_a_day(db_session, seed_owner, monkeypatch):
    from app.models.user import User

    db_session.add(
        User(
            username="ops",
            email="ops@test.local",
            password_hash="x",
            full_name="Ops",
            is_active=True,
            is_platform_admin=True,
        )
    )
    _stamp(db_session, "009_automations_feature")
    _queued(db_session, "Spent", provisioning_attempts=provisioning.MAX_ATTEMPTS)
    sent = []
    monkeypatch.setattr(platform_emails, "send_account_email", lambda **m: sent.append(m["subject"]))
    summary = platform_jobs.health_watch(db_session, now=NOW)
    assert "schema" in summary and "provisioning_failed" in summary
    platform_jobs.health_watch(db_session, now=NOW + timedelta(hours=1))  # same day: nothing new
    from app.core.config import settings

    assert sorted(sent) == sorted(
        [
            f"{settings.APP_NAME}: database schema doesn't match the code",
            f"{settings.APP_NAME}: tenant setup keeps failing",
        ]
    )
