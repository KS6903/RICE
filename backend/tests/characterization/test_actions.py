"""Tasks: an alert someone is fixing, by when, and whether it's done. An
automation can track its alerts as tasks, anyone can make one from an alert,
and a task past due goes to the owner and admins once."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.automations.actions import escalate
from app.automations.engine import run_due_automations
from app.core.security import get_current_user
from app.jobs.registry import JobContext
from app.main import app
from app.models.action import ActionItem
from app.models.automation import AutomationRule
from app.models.company import Company
from app.models.notification import Notification
from app.models.user import Role, User
from app.services.notification_service import notify

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime.fromisoformat("2026-09-29T06:05+08:00")


@pytest.fixture
def company(db_session, seed_owner) -> Company:
    return db_session.get(Company, seed_owner.company_id)


def _member(db_session, owner: User, username: str, role: str) -> User:
    found = db_session.query(Role).filter(Role.name == role).first()
    if found is None:
        found = Role(id=10 + db_session.query(Role).count(), name=role)
        db_session.add(found)
        db_session.flush()
    user = User(
        company_id=owner.company_id,
        branch_id=owner.branch_id,
        username=username,
        email=f"{username}@test.local",
        password_hash=owner.password_hash,
        full_name=username.capitalize(),
        role_id=found.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _as(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _notices(db_session, user: User) -> list[Notification]:
    db_session.expire_all()
    return (
        db_session.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.created_at).all()
    )


def test_a_tracked_automation_makes_one_task_per_alert(db_session, company, seed_owner):
    books = _member(db_session, seed_owner, "books", "accountant")
    db_session.add(
        AutomationRule(
            company_id=company.id,
            recipe="owner_digest",
            enabled=True,
            params={},
            recipients=[],
            track=True,
            track_assignee=books.id,
            track_due_hours=6,
        )
    )
    db_session.commit()
    ctx = JobContext(db=db_session, now=NOW, zone=MANILA, run_key="tick", company=company)
    assert run_due_automations(ctx) == "1 automation(s) ran, 0 failed"
    run_due_automations(ctx)  # the same day again: nothing new

    db_session.expire_all()
    [task] = db_session.query(ActionItem).all()
    assert (task.source, task.assignee_id, task.status) == ("owner_digest", books.id, "open")
    assert task.due_at == NOW + timedelta(hours=6)
    assert task.title.startswith("Yesterday at Test Mill")
    [told] = _notices(db_session, books)
    assert told.title.startswith("For you to do: Yesterday at Test Mill")
    assert told.link == "/tasks"


def test_a_task_past_due_goes_to_the_owner_and_admins_once(db_session, company, seed_owner):
    worker = _member(db_session, seed_owner, "ena", "encoder")
    admin = _member(db_session, seed_owner, "adm", "admin")
    db_session.add(
        ActionItem(
            company_id=company.id,
            source="wet_palay",
            source_key="wet_palay:PP-1",
            title="Wet palay not drying: PP-1",
            assignee_id=worker.id,
            due_at=NOW - timedelta(hours=1),
        )
    )
    db_session.add(
        ActionItem(
            company_id=company.id,
            source="wet_palay",
            source_key="wet_palay:PP-2",
            title="Not due yet",
            due_at=NOW + timedelta(hours=1),
        )
    )
    db_session.commit()
    assert escalate(db_session, company, now=NOW, zone=MANILA) == 1
    assert escalate(db_session, company, now=NOW + timedelta(minutes=15), zone=MANILA) == 0
    db_session.commit()
    for person in (seed_owner, admin, worker):
        [notice] = _notices(db_session, person)
        assert notice.title == "Overdue: Wet palay not drying: PP-1"
        assert notice.body == "Was due Tue 29 Sep, 05:05. Assigned to Ena, who hasn't started it."


def test_the_assignee_works_the_task_and_others_cannot(auth_client, db_session, company, seed_owner):
    worker = _member(db_session, seed_owner, "ena", "accountant")
    other = _member(db_session, seed_owner, "ben", "accountant")
    task = ActionItem(
        company_id=company.id,
        source="due_reminders",
        source_key="due_reminders:2026-09-29",
        title="Collections: 2 overdue invoices",
        assignee_id=worker.id,
        due_at=NOW,
    )
    db_session.add(task)
    db_session.commit()

    _as(other)
    assert auth_client.get("/api/actions/").json()["tasks"] == []
    assert auth_client.get("/api/actions/?scope=all").json()["tasks"] == []  # not a manager: own tasks only
    assert auth_client.post(f"/api/actions/{task.id}/resolve", json={}).status_code == 403

    _as(worker)
    [mine] = auth_client.get("/api/actions/").json()["tasks"]
    assert (mine["title"], mine["status"], mine["overdue"]) == ("Collections: 2 overdue invoices", "open", True)
    assert auth_client.post(f"/api/actions/{task.id}/acknowledge").json()["status"] == "acknowledged"
    done = auth_client.post(f"/api/actions/{task.id}/resolve", json={"note": "Nena paid ₱5,000; rest Friday."}).json()
    assert (done["status"], done["resolved_by"], done["resolution"]) == (
        "resolved",
        "Ena",
        "Nena paid ₱5,000; rest Friday.",
    )
    assert auth_client.get("/api/actions/").json()["tasks"] == []
    assert [t["id"] for t in auth_client.get("/api/actions/?done=true").json()["tasks"]] == [str(task.id)]

    _as(seed_owner)
    listed = auth_client.get("/api/actions/?scope=all&done=true").json()
    assert listed["manager"] is True and len(listed["tasks"]) == 1


def test_an_alert_becomes_a_task_for_someone_who_may_receive_it(auth_client, db_session, company, seed_owner):
    books = _member(db_session, seed_owner, "books", "accountant")
    till = _member(db_session, seed_owner, "till", "mill_operator")
    notify(
        db_session,
        company_id=company.id,
        user_ids=[seed_owner.id],
        kind="automation.due_reminders",
        title="Collections: 1 overdue invoice",
        dedupe_key="due_reminders:2026-09-29",
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
    alert, plan_notice = _notices(db_session, seed_owner)
    due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    # Not an automation's alert.
    res = auth_client.post("/api/actions/", json={"notification_id": str(plan_notice.id), "due_at": due})
    assert res.status_code == 400
    # A mill operator has no access to sales, where collections alerts belong, so can't be given one.
    people = {p["name"] for p in auth_client.get("/api/actions/people?source=due_reminders").json()["people"]}
    assert "Till" not in people and "Books" in people
    res = auth_client.post(
        "/api/actions/", json={"notification_id": str(alert.id), "assignee_id": str(till.id), "due_at": due}
    )
    assert res.status_code == 400

    res = auth_client.post(
        "/api/actions/", json={"notification_id": str(alert.id), "assignee_id": str(books.id), "due_at": due}
    )
    assert res.status_code == 201, res.text
    assert res.json()["assignee"]["name"] == "Books"
    again = auth_client.post("/api/actions/", json={"notification_id": str(alert.id), "due_at": due})
    assert again.status_code == 409


def test_only_managers_give_tasks_to_others(auth_client, db_session, company, seed_owner):
    books = _member(db_session, seed_owner, "books", "accountant")
    task = ActionItem(company_id=company.id, source="manual", source_key="k", title="Count the drawer", due_at=NOW)
    db_session.add(task)
    db_session.commit()
    _as(books)
    res = auth_client.post(f"/api/actions/{task.id}/assign", json={"assignee_id": str(books.id)})
    assert res.status_code == 403
    _as(seed_owner)
    res = auth_client.post(f"/api/actions/{task.id}/assign", json={"assignee_id": str(books.id)})
    assert res.status_code == 200 and res.json()["assignee"]["name"] == "Books"
    [told] = _notices(db_session, books)
    assert told.title == "For you to do: Count the drawer"


def test_tasks_need_enterprise(make_auth_client):
    client = make_auth_client(features=["sales"], username="pro")
    assert client.get("/api/actions/").status_code == 402
