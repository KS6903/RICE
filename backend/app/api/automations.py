"""Automations HTTP controller (Enterprise only).

Plan gate: require_feature("automations") answers 402 for tenants not on
Enterprise. Role gate: the "automations" section; owners and admins manage,
accountants can look, everyone else gets 403.

AI recipes send the mill's records to DeepSeek, so they also need the tenant's
AI switch on (PUT /ai), which only an owner can flip.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..automations import ai, engine, presets
from ..automations.base import Field as RecipeField
from ..automations.base import Recipe, RecipeProblem
from ..automations.recipes import RECIPES
from ..automations.sources import saved_locations
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..core.timezones import tenant_zone
from ..models.automation import AutomationRule, AutomationSettings
from ..models.job_run import JobRun
from ..models.user import User
from ..services.notification_service import undelivered_emails

router = APIRouter(
    dependencies=[Depends(require_feature("automations")), Depends(require_section_access("automations"))]
)
manage = [Depends(require_section_access("automations", write=True))]


class AISettingsUpdate(BaseModel):
    enabled: bool
    language: str = "en"

    @field_validator("language")
    @classmethod
    def _known_language(cls, value: str) -> str:
        if value not in ai.LANGUAGES:
            raise ValueError("Unknown language")
        return value


class RuleUpdate(BaseModel):
    enabled: bool
    params: dict = Field(default_factory=dict)
    # User ids; empty means "the recipe's default recipients".
    recipients: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    # Track each alert as a task until it's resolved (app/automations/actions).
    # Each is left as it is when not sent.
    track: bool | None = None
    track_assignee: uuid.UUID | None = None
    track_due_hours: int | None = Field(None, ge=1, le=24 * 14)


def _recipe(code: str) -> Recipe:
    recipe = RECIPES.get(code)
    if recipe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such automation")
    return recipe


def _last_run(db: Session, company_id: uuid.UUID, recipe: Recipe) -> dict | None:
    run = db.scalars(
        select(JobRun)
        .where(JobRun.job == engine.job_name(recipe.code), JobRun.company_id == company_id)
        .order_by(JobRun.started_at.desc())
        .limit(1)
    ).first()
    return _run_out(run) if run else None


def _run_out(run: JobRun) -> dict:
    return {
        "run_key": run.run_key,
        "status": run.status,
        "started_at": run.started_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "detail": run.detail,
    }


def _tenant_options(db: Session, company_id: uuid.UUID, field: RecipeField) -> list[tuple[str, str]]:
    if field.options_from == "saved_locations":
        return [(str(loc.id), loc.label) for loc in saved_locations(db, company_id)]
    return []


def _serialize(db: Session, company_id: uuid.UUID, recipe: Recipe, rule: AutomationRule | None) -> dict:
    params = engine.parse_params(recipe, rule.params if rule else None)
    candidates = engine.eligible_users(db, company_id, recipe)
    chosen = [str(x) for x in (rule.recipients if rule else [])]
    effective = engine.recipient_ids(db, company_id, recipe, chosen)
    return {
        "code": recipe.code,
        "title": recipe.title,
        "description": recipe.description,
        "group": recipe.group,
        "section": recipe.section,
        "fields": [
            {
                "name": f.name,
                "label": f.label,
                "kind": f.kind,
                "help": f.help,
                "unit": f.unit,
                "options": [
                    {"value": v, "label": label} for v, label in (*f.options, *_tenant_options(db, company_id, f))
                ],
            }
            for f in recipe.fields
        ],
        "params": params.model_dump(),
        "enabled": bool(rule and rule.enabled),
        "recipients": chosen,
        "effective_recipients": [str(i) for i in effective],
        "default_roles": list(recipe.default_roles),
        "candidates": [
            {"id": str(u.id), "name": u.full_name or u.username, "role": u.role.name if u.role else None}
            for u in candidates
        ],
        "last_run": _last_run(db, company_id, recipe),
        "uses_ai": recipe.uses_ai,
        "ai_optional": recipe.ai_optional,
        "track": bool(rule and rule.track),
        "track_assignee": str(rule.track_assignee) if rule and rule.track_assignee else None,
        "track_due_hours": rule.track_due_hours if rule and rule.track_due_hours else 24,
    }


def _ai_out(db: Session, company_id: uuid.UUID) -> dict:
    settings = engine.ai_settings(db, company_id)
    changed_by = db.get(User, settings.ai_changed_by) if settings and settings.ai_changed_by else None
    return {
        "enabled": bool(settings and settings.ai_enabled),
        "language": settings.ai_language if settings else "en",
        "languages": [{"value": code, "label": label.split(":")[0]} for code, label in ai.LANGUAGES.items()],
        "configured": ai.configured(),
        "changed_by": (changed_by.full_name or changed_by.username) if changed_by else None,
        "changed_at": settings.ai_changed_at.isoformat() if settings and settings.ai_changed_at else None,
    }


# The jobs tick every 15 minutes; three missed ticks means they aren't running
# on this server (the cron trigger is missing, or the jobs container can't start).
SCHEDULER_STALE_AFTER = timedelta(minutes=45)
# How far back the page counts emails that never reached anyone.
UNDELIVERED_WINDOW = timedelta(days=7)


def _health(db: Session, company_id: uuid.UUID) -> dict:
    """Is anything stopping the automations from reaching people? The page says
    so plainly, instead of showing switches that look on but do nothing."""
    now = datetime.now(timezone.utc)
    last_tick = db.scalar(
        select(JobRun.started_at)
        .where(JobRun.job == "automations.run", JobRun.company_id == company_id)
        .order_by(JobRun.started_at.desc())
        .limit(1)
    )
    return {
        "scheduler_running": bool(last_tick and now - last_tick <= SCHEDULER_STALE_AFTER),
        "last_tick": last_tick.isoformat() if last_tick else None,
        "emails": undelivered_emails(db, kind_prefix="automation.", since=now - UNDELIVERED_WINDOW),
    }


@router.get("/")
def list_automations(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    rules = {r.recipe: r for r in db.query(AutomationRule).all()}
    return {
        "recipes": [
            _serialize(db, current_user.company_id, recipe, rules.get(code)) for code, recipe in RECIPES.items()
        ],
        "ai": _ai_out(db, current_user.company_id),
        "health": _health(db, current_user.company_id),
    }


@router.put("/ai", dependencies=manage)
def update_ai(body: AISettingsUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Switch AI on or off for the mill's automations, and pick its language.
    Owner only: it sends the mill's records abroad, the owner's decision to make."""
    if not current_user.role or current_user.role.name != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the mill's owner can change the AI settings."
        )
    settings = engine.ai_settings(db, current_user.company_id)
    if settings is None:
        settings = AutomationSettings(company_id=current_user.company_id)
        db.add(settings)
    if bool(settings.ai_enabled) != body.enabled:
        settings.ai_changed_by = current_user.id
        settings.ai_changed_at = datetime.now(timezone.utc)
    settings.ai_enabled = body.enabled
    settings.ai_language = body.language
    db.commit()
    return _ai_out(db, current_user.company_id)


@router.get("/presets")
def list_presets():
    return {
        "presets": [
            {
                "code": p.code,
                "title": p.title,
                "description": p.description,
                "recipes": [{"code": c, "title": RECIPES[c].title} for c in p.recipes],
            }
            for p in presets.PRESETS.values()
        ]
    }


@router.post("/presets/{code}", dependencies=manage)
def apply_preset(code: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Switch on a starter set. Only switches on; what's set up stays as it is."""
    preset = presets.PRESETS.get(code)
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such starter set")
    switched = presets.apply(db, current_user.company_id, preset, current_user.id)
    db.commit()
    return {"switched_on": switched}


@router.put("/{code}", dependencies=manage)
def update_automation(
    code: str, body: RuleUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    recipe = _recipe(code)
    if recipe.uses_ai and body.enabled and not engine.ai_enabled(db, current_user.company_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Switch on AI for your automations first, at the top of the AI advisor section.",
        )
    try:
        params = engine.parse_params(recipe, body.params)
    except ValidationError as exc:
        messages = "; ".join(str(e["msg"]).removeprefix("Value error, ") for e in exc.errors())
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=messages) from exc
    eligible = {u.id for u in engine.eligible_users(db, current_user.company_id, recipe)}
    refused = [str(i) for i in body.recipients if i not in eligible]
    if refused:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"These people can't receive this automation: their role has no access to {recipe.section}.",
        )
    if body.track_assignee is not None and body.track_assignee not in eligible:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"That person can't be given these tasks: their role has no access to {recipe.section}.",
        )
    rule = db.query(AutomationRule).filter(AutomationRule.recipe == code).first()
    if rule is None:
        rule = AutomationRule(company_id=current_user.company_id, recipe=code)
        db.add(rule)
    rule.enabled = body.enabled
    rule.params = params.model_dump()
    rule.recipients = [str(i) for i in dict.fromkeys(body.recipients)]
    if body.track is not None:
        rule.track = body.track
    if "track_assignee" in body.model_fields_set:
        rule.track_assignee = body.track_assignee
    if body.track_due_hours is not None:
        rule.track_due_hours = body.track_due_hours
    rule.updated_by = current_user.id
    db.commit()
    db.refresh(rule)
    return _serialize(db, current_user.company_id, recipe, rule)


@router.post("/{code}/test", dependencies=manage)
def send_test(code: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    recipe = _recipe(code)
    company = current_user.company
    try:
        result = engine.send_test(
            db, company, recipe, current_user, now=datetime.now(timezone.utc), zone=tenant_zone(company.timezone)
        )
    except RecipeProblem as exc:
        # Raised before anything is written: nothing to undo.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    # Their own address, so they know where to look (or that it's the wrong one).
    return {**result, "to": current_user.email if result["email"] == "sent" else None}


@router.get("/{code}/runs")
def list_runs(code: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    recipe = _recipe(code)
    runs = db.scalars(
        select(JobRun)
        .where(JobRun.job == engine.job_name(recipe.code), JobRun.company_id == current_user.company_id)
        .order_by(JobRun.started_at.desc())
        .limit(20)
    ).all()
    return {"runs": [_run_out(r) for r in runs]}
