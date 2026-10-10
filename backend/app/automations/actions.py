"""Alerts as tasks: who is fixing it, by when, and whether it's done.

A notice under the bell tells people something needs doing. Reading it doesn't
say anyone is doing it. A task does: it has one person it's assigned to, a time
it's due, "I'm on it" when they start, and a note when it's resolved. Past due
and still open, it goes to the owner and admins once.

Tasks are made two ways: an automation set to track its alerts (the rule's
track settings) makes one per alert, and anyone can make one from an alert in
the bell. Either way the alert's dedupe key is the task's source_key, so the
same alert is never two tasks.

Nothing here commits.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..models.action import ActionItem
from ..models.automation import AutomationRule
from ..models.company import Company
from ..models.user import User
from ..services.notification_service import notify
from .base import Notice, Recipe
from .format import local_time

MANAGER_ROLES = ("owner", "admin")
STATUSES = ("open", "acknowledged", "resolved")


def is_manager(user: User) -> bool:
    return bool(user.role and user.role.name in MANAGER_ROLES)


def team(db: Session, company_id: uuid.UUID) -> list[User]:
    return (
        db.query(User)
        .filter(User.company_id == company_id, User.is_active.is_(True), User.is_platform_admin.is_(False))
        .order_by(User.full_name)
        .all()
    )


def assignable(db: Session, company_id: uuid.UUID, recipe: Recipe | None) -> list[User]:
    """Who a task may go to: for an automation's alert, the people who may
    receive that automation (the alert can name figures their role can't
    see otherwise); for anything else, anyone on the team."""
    if recipe is None:
        return team(db, company_id)
    from .engine import eligible_users

    return eligible_users(db, company_id, recipe)


def name(user: User | None) -> str:
    return (user.full_name or user.username) if user else "nobody yet"


def open_task(
    db: Session,
    company: Company,
    *,
    source: str,
    source_key: str,
    title: str,
    body: str | None,
    link: str | None,
    assignee_id: uuid.UUID | None,
    created_by: uuid.UUID | None,
    due_at: datetime,
) -> ActionItem | None:
    """Make the task, unless this alert already is one; tell the assignee.
    Returns the new task, or None when it already existed."""
    task_id = db.execute(
        insert(ActionItem)
        .values(
            id=uuid.uuid4(),
            company_id=company.id,
            source=source[:40],
            source_key=source_key[:120],
            title=title[:160],
            body=body,
            link=link,
            assignee_id=assignee_id,
            created_by=created_by,
            due_at=due_at,
            status="open",
        )
        .on_conflict_do_nothing(constraint="uq_action_items_source_key")
        .returning(ActionItem.id)
    ).scalar()
    if task_id is None:
        return None
    task = db.get(ActionItem, task_id)
    assert task is not None
    if assignee_id is not None and assignee_id != created_by:
        tell_assignee(db, company, task)
    return task


def tell_assignee(db: Session, company: Company, task: ActionItem) -> None:
    if task.assignee_id is None:
        return
    notify(
        db,
        company_id=company.id,
        user_ids=[task.assignee_id],
        kind="action.assigned",
        title=f"For you to do: {task.title}",
        body=task.body,
        link="/tasks",
        dedupe_key=f"action:{task.id}:assigned:{task.assignee_id}",
        email=True,
    )


def track(
    db: Session, company: Company, rule: AutomationRule, recipe: Recipe, notices: Sequence[Notice], *, now: datetime
) -> int:
    """Make a task of each alert, when the rule tracks its alerts. Returns how
    many were new. The assignee must still be able to receive the automation;
    if not, the task waits for a manager to assign it."""
    if not rule.track or not notices:
        return 0
    allowed = {u.id for u in assignable(db, company.id, recipe)}
    assignee = rule.track_assignee if rule.track_assignee in allowed else None
    due_at = now + timedelta(hours=rule.track_due_hours or 24)
    made = 0
    for n in notices:
        task = open_task(
            db,
            company,
            source=recipe.code,
            source_key=n.dedupe_key,
            title=n.title,
            body=n.body,
            link=n.link,
            assignee_id=assignee,
            created_by=None,
            due_at=due_at,
        )
        made += task is not None
    return made


def escalate(db: Session, company: Company, *, now: datetime, zone: ZoneInfo) -> int:
    """Tell the owner and admins, and the assignee, about each task past its
    due time and still not resolved, once. Returns how many were escalated."""
    overdue = (
        db.query(ActionItem)
        .filter(ActionItem.status != "resolved", ActionItem.due_at < now, ActionItem.escalated_at.is_(None))
        .order_by(ActionItem.due_at)
        .all()
    )
    if not overdue:
        return 0
    people = team(db, company.id)
    managers = [u.id for u in people if is_manager(u)]
    by_id = {u.id: u for u in people}
    for task in overdue:
        assignee = by_id.get(task.assignee_id) if task.assignee_id else None
        if assignee is None:
            state = "Nobody has taken it yet. Assign it on the To do page."
        elif task.status == "acknowledged":
            state = f"{name(assignee)} is on it but hasn't marked it resolved."
        else:
            state = f"Assigned to {name(assignee)}, who hasn't started it."
        notify(
            db,
            company_id=company.id,
            user_ids=[*managers, *([assignee.id] if assignee else [])],
            kind="action.overdue",
            title=f"Overdue: {task.title}",
            body=f"Was due {local_time(task.due_at, zone)}. {state}",
            link="/tasks",
            dedupe_key=f"action:{task.id}:overdue",
            email=True,
        )
        task.escalated_at = now
    return len(overdue)
