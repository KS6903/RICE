"""Tasks HTTP controller (Enterprise, with the automations): alerts someone is
fixing, by when, and whether they're done.

Everyone on the team sees and works the tasks given to them. Owners and admins
see every task, assign and reassign them. Anyone may make a task of an alert
they received, for themselves; owners and admins may give it to anyone who may
receive that alert.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy.orm import Session

from ..automations import actions
from ..automations.engine import job_name
from ..automations.recipes import RECIPES
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..models.action import ActionItem
from ..models.notification import Notification
from ..models.user import User

router = APIRouter(dependencies=[Depends(require_feature("automations")), Depends(require_section_access("tasks"))])


class TaskFromNotice(BaseModel):
    notification_id: uuid.UUID
    # Leave out to take it yourself.
    assignee_id: uuid.UUID | None = None
    due_at: AwareDatetime


class Assign(BaseModel):
    assignee_id: uuid.UUID
    due_at: AwareDatetime | None = None


class Resolve(BaseModel):
    note: str = Field("", max_length=500)


def _recipe_of(kind: str):
    """The automation an alert came from, by its kind ("automation.<code>")."""
    code = kind.removeprefix("automation.") if kind.startswith("automation.") else None
    return RECIPES.get(code) if code else None


def _out(task: ActionItem, people: dict[uuid.UUID, User], now: datetime) -> dict:
    assignee = people.get(task.assignee_id) if task.assignee_id else None
    resolver = people.get(task.resolved_by) if task.resolved_by else None
    return {
        "id": str(task.id),
        "source": task.source,
        "title": task.title,
        "body": task.body,
        "link": task.link,
        "status": task.status,
        "assignee": {"id": str(assignee.id), "name": actions.name(assignee)} if assignee else None,
        "due_at": task.due_at.isoformat(),
        "overdue": task.status != "resolved" and task.due_at < now,
        "created_at": task.created_at.isoformat(),
        "acknowledged_at": task.acknowledged_at.isoformat() if task.acknowledged_at else None,
        "resolved_at": task.resolved_at.isoformat() if task.resolved_at else None,
        "resolved_by": actions.name(resolver) if resolver else None,
        "resolution": task.resolution,
    }


def _people(db: Session, company_id: uuid.UUID) -> dict[uuid.UUID, User]:
    return {u.id: u for u in db.query(User).filter(User.company_id == company_id)}


def _task(db: Session, task_id: uuid.UUID) -> ActionItem:
    task = db.get(ActionItem, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such task")
    return task


def _may_work(user: User, task: ActionItem) -> None:
    if not (actions.is_manager(user) or task.assignee_id == user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This task is someone else's.")


def _check_assignee(db: Session, user: User, assignee_id: uuid.UUID, source: str) -> None:
    if assignee_id != user.id and not actions.is_manager(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only an owner or admin can give a task to someone else."
        )
    assert user.company_id is not None
    allowed = {u.id for u in actions.assignable(db, user.company_id, RECIPES.get(source))}
    if assignee_id not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That person can't receive this alert, so they can't be given the task.",
        )


@router.get("/")
def list_tasks(
    scope: str = Query("mine", pattern="^(mine|all)$"),
    done: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ActionItem)
    if scope == "all" and actions.is_manager(current_user):
        pass
    else:
        query = query.filter(ActionItem.assignee_id == current_user.id)
    if done:
        query = query.filter(ActionItem.status == "resolved").order_by(ActionItem.resolved_at.desc()).limit(50)
    else:
        query = query.filter(ActionItem.status != "resolved").order_by(ActionItem.due_at)
    now = datetime.now(timezone.utc)
    people = _people(db, current_user.company_id)
    unassigned = (
        db.query(ActionItem).filter(ActionItem.status != "resolved", ActionItem.assignee_id.is_(None)).count()
        if actions.is_manager(current_user)
        else 0
    )
    return {
        "tasks": [_out(t, people, now) for t in query.all()],
        "manager": actions.is_manager(current_user),
        "unassigned": unassigned,
    }


@router.get("/people")
def assignable_people(source: str = "manual", current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Who a task from this source may be given to."""
    users = actions.assignable(db, current_user.company_id, RECIPES.get(source))
    if not actions.is_manager(current_user):
        users = [u for u in users if u.id == current_user.id]
    return {
        "people": [{"id": str(u.id), "name": actions.name(u), "role": u.role.name if u.role else None} for u in users]
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
def task_from_notice(body: TaskFromNotice, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Make a task of an alert the signed-in user received."""
    notice = db.get(Notification, body.notification_id)
    if notice is None or notice.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such alert")
    recipe = _recipe_of(notice.kind)
    if recipe is None or notice.kind != job_name(recipe.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Only alerts from your automations can become tasks."
        )
    assignee_id = body.assignee_id or current_user.id
    _check_assignee(db, current_user, assignee_id, recipe.code)
    task = actions.open_task(
        db,
        current_user.company,
        source=recipe.code,
        source_key=notice.dedupe_key,
        title=notice.title,
        body=notice.body,
        link=notice.link,
        assignee_id=assignee_id,
        created_by=current_user.id,
        due_at=body.due_at,
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This alert is already a task.")
    db.commit()
    return _out(task, _people(db, current_user.company_id), datetime.now(timezone.utc))


@router.post("/{task_id}/acknowledge")
def acknowledge(task_id: uuid.UUID, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    task = _task(db, task_id)
    _may_work(current_user, task)
    if task.status == "open":
        task.status = "acknowledged"
        task.acknowledged_at = datetime.now(timezone.utc)
        db.commit()
    return _out(task, _people(db, current_user.company_id), datetime.now(timezone.utc))


@router.post("/{task_id}/resolve")
def resolve(task_id: uuid.UUID, body: Resolve, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    task = _task(db, task_id)
    _may_work(current_user, task)
    if task.status != "resolved":
        task.status = "resolved"
        task.resolved_at = datetime.now(timezone.utc)
        task.resolved_by = current_user.id
        task.resolution = body.note.strip() or None
        db.commit()
    return _out(task, _people(db, current_user.company_id), datetime.now(timezone.utc))


@router.post("/{task_id}/assign")
def assign(task_id: uuid.UUID, body: Assign, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not actions.is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an owner or admin can assign tasks.")
    task = _task(db, task_id)
    if task.status == "resolved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This task is already resolved.")
    _check_assignee(db, current_user, body.assignee_id, task.source)
    changed = task.assignee_id != body.assignee_id
    task.assignee_id = body.assignee_id
    if body.due_at is not None:
        task.due_at = body.due_at
        task.escalated_at = None  # a new due time: escalate again if it's missed
    if changed:
        task.status = "open"
        task.acknowledged_at = None
        actions.tell_assignee(db, current_user.company, task)
    db.commit()
    return _out(task, _people(db, current_user.company_id), datetime.now(timezone.utc))
