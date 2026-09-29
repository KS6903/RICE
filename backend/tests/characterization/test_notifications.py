"""Notifications: each user sees only their own, nothing is repeated, and email
goes out only after the work commits, within a daily cap."""

from __future__ import annotations

import uuid

import pytest

from app.core.tenancy import set_search_path
from app.models.company import Company
from app.models.user import User
from app.services import notification_service
from app.services.notification_service import deliver_pending_emails, notify


def _on_tenant(db_session, owner: User) -> Company:
    company = db_session.get(Company, owner.company_id)
    set_search_path(db_session, company.schema_name)
    return company


def _second_user(db_session, owner: User) -> User:
    other = User(
        company_id=owner.company_id,
        branch_id=owner.branch_id,
        username=f"other-{uuid.uuid4().hex[:8]}",
        email="other@example.test",
        password_hash=owner.password_hash,
        full_name="Other User",
        role_id=owner.role_id,
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()
    return other


def test_the_same_notice_is_never_recorded_twice(db_session, seed_owner):
    company = _on_tenant(db_session, seed_owner)
    for _ in range(2):
        notify(
            db_session,
            company_id=company.id,
            user_ids=[seed_owner.id, seed_owner.id],
            kind="test.kind",
            title="Plan expires in 7 days",
            dedupe_key="subscription.expiring:2026-10-05:7",
        )
    db_session.commit()
    assert notification_service.unread_count(db_session, seed_owner.id) == 1


def test_users_see_only_their_own_notices(auth_client, db_session, seed_owner):
    company = _on_tenant(db_session, seed_owner)
    other = _second_user(db_session, seed_owner)
    notify(db_session, company_id=company.id, user_ids=[seed_owner.id], kind="k", title="For the owner", dedupe_key="a")
    notify(db_session, company_id=company.id, user_ids=[other.id], kind="k", title="For someone else", dedupe_key="b")
    db_session.commit()

    body = auth_client.get("/api/notifications/").json()
    assert [n["title"] for n in body["items"]] == ["For the owner"]
    assert body["unread"] == 1


def test_marking_read_clears_the_unread_count(auth_client, db_session, seed_owner):
    company = _on_tenant(db_session, seed_owner)
    for key in ("one", "two"):
        notify(db_session, company_id=company.id, user_ids=[seed_owner.id], kind="k", title=key, dedupe_key=key)
    db_session.commit()

    first = auth_client.get("/api/notifications/").json()["items"][0]["id"]
    assert auth_client.post("/api/notifications/read", json={"ids": [first]}).json() == {"updated": 1}
    assert auth_client.get("/api/auth/me").json()["notifications_unread"] == 1
    assert auth_client.post("/api/notifications/read", json={}).json() == {"updated": 1}
    assert auth_client.get("/api/auth/me").json()["notifications_unread"] == 0


def test_emails_go_out_once_and_record_the_outcome(db_session, seed_owner, monkeypatch):
    company = _on_tenant(db_session, seed_owner)
    sent_to: list[str] = []
    monkeypatch.setattr("app.core.mailer.Mailer.send", lambda self, **kw: sent_to.append(kw["to"]) or True)
    notify(
        db_session,
        company_id=company.id,
        user_ids=[seed_owner.id],
        kind="k",
        title="Digest",
        dedupe_key="digest:2026-09-28",
        email=True,
    )
    db_session.commit()

    assert deliver_pending_emails(db_session)["sent"] == 1
    assert deliver_pending_emails(db_session)["sent"] == 0  # nothing left pending
    assert sent_to == [seed_owner.email]


def test_the_daily_cap_defers_the_rest(db_session, seed_owner, monkeypatch):
    company = _on_tenant(db_session, seed_owner)
    monkeypatch.setattr("app.core.mailer.Mailer.send", lambda self, **kw: True)
    monkeypatch.setattr(notification_service, "DAILY_EMAIL_CAP", 1)
    for key in ("a", "b"):
        notify(
            db_session, company_id=company.id, user_ids=[seed_owner.id], kind="k", title=key, dedupe_key=key, email=True
        )
    db_session.commit()
    outcome = deliver_pending_emails(db_session)
    assert (outcome["sent"], outcome["deferred"]) == (1, 1)


def test_without_smtp_in_development_emails_are_skipped_not_failed(db_session, seed_owner):
    company = _on_tenant(db_session, seed_owner)
    notify(db_session, company_id=company.id, user_ids=[seed_owner.id], kind="k", title="t", dedupe_key="k", email=True)
    db_session.commit()
    assert deliver_pending_emails(db_session)["skipped"] == 1


@pytest.mark.parametrize("path", ["/api/notifications/"])
def test_notifications_require_sign_in(client, path):
    assert client.get(path).status_code == 401
