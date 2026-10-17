"""Run the tenant's switched-on recipes when they fall due.

Called once per jobs tick for each tenant (the automations.run job). For each
enabled rule whose recipe is due, the run is claimed in job_runs under
"automation.<recipe>" (so it happens at most once, with the runner's retry
and dead-runner recovery), the recipe builds its notices, and they go to the
rule's recipients as notifications. The notifications job emails them.

Entitlement is read from the database on every tick, not from the features
cache. A tenant that moved off Enterprise has its rules skipped, not deleted,
and on its return only runs due from then on happen: no burst of missed
digests.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta

from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from ..core.access_policy import section_level
from ..jobs.registry import JobContext
from ..jobs.runner import claim_run, finish_run
from ..models.automation import AutomationRule, AutomationSettings
from ..models.company import Company
from ..models.notification import Notification
from ..models.subscription import Subscription
from ..models.user import User
from ..services.notification_service import attach, notify
from ..services.subscription import is_active
from . import actions
from .base import Notice, Recipe, RecipeContext, RecipeProblem, asks_ai
from .recipes import RECIPES

logger = logging.getLogger("ricemill.automations")

FEATURE = "automations"


def job_name(recipe_code: str) -> str:
    return f"automation.{recipe_code}"


def entitled(db: Session, company_id: uuid.UUID) -> bool:
    """True when the tenant's subscription is active and its plan includes automations."""
    sub = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    return bool(sub and sub.plan and is_active(sub) and FEATURE in (sub.plan.features or []))


def eligible_users(db: Session, company_id: uuid.UUID, recipe: Recipe) -> list[User]:
    """Active users of the tenant whose role may see what the recipe sends."""
    users = (
        db.query(User)
        .filter(User.company_id == company_id, User.is_active.is_(True), User.is_platform_admin.is_(False))
        .order_by(User.full_name)
        .all()
    )
    # What each role can open in this mill, as its Boss has set it: a role that
    # was shut out of a page isn't told what is on it.
    overrides = db.query(Company.role_access).filter(Company.id == company_id).scalar()
    return [
        u
        for u in users
        if u.role
        and section_level(u.role.name, recipe.section, overrides) != "none"
        and (not recipe.only_roles or u.role.name in recipe.only_roles)
    ]


def recipient_ids(db: Session, company_id: uuid.UUID, recipe: Recipe, chosen: Sequence[str]) -> list[uuid.UUID]:
    """The rule's chosen recipients who are still eligible, or, when nobody was
    chosen, everyone eligible in the recipe's default roles."""
    eligible = {u.id: u for u in eligible_users(db, company_id, recipe)}
    picked: list[uuid.UUID] = []
    for raw in chosen:
        try:
            user_id = uuid.UUID(str(raw))
        except ValueError:
            continue
        if user_id in eligible:
            picked.append(user_id)
    if chosen:
        return picked
    return [u.id for u in eligible.values() if u.role.name in recipe.default_roles]


def parse_params(recipe: Recipe, raw: dict | None) -> BaseModel:
    return recipe.params(**(raw or {}))


def deliver(
    db: Session,
    company: Company,
    recipe: Recipe,
    notices: Sequence[Notice],
    user_ids: Sequence[uuid.UUID],
    *,
    email: bool,
    key_suffix: str = "",
) -> int:
    """Record the notices for the recipients. Does not commit; returns how many were new."""
    new = 0
    for n in notices:
        key = n.dedupe_key + key_suffix
        new += notify(
            db,
            company_id=company.id,
            user_ids=user_ids,
            kind=job_name(recipe.code),
            title=n.title,
            body=n.body,
            link=n.link,
            dedupe_key=key,
            email=email,
        )
        if email and n.attachments and user_ids:
            attach(db, company_id=company.id, dedupe_key=key, attachments=n.attachments)
    return new


def ai_settings(db: Session, company_id: uuid.UUID) -> AutomationSettings | None:
    return db.query(AutomationSettings).filter(AutomationSettings.company_id == company_id).first()


def ai_enabled(db: Session, company_id: uuid.UUID) -> bool:
    settings = ai_settings(db, company_id)
    return bool(settings and settings.ai_enabled)


def run_due_automations(ctx: JobContext, *, ai: bool = False) -> str:
    """Run the due recipes of one kind: rule-based ones (automations.run), or
    the AI ones (automations.run_ai), which are slow and run in their own job
    so they never hold up the rest."""
    company = ctx.company
    assert company is not None, "automations are a tenant job"
    settings = ai_settings(ctx.db, company.id)
    ai_on = bool(settings and settings.ai_enabled)
    rules: list[tuple[AutomationRule, Recipe, BaseModel]] = []
    for rule in ctx.db.query(AutomationRule).filter(AutomationRule.enabled.is_(True)).all():
        recipe = RECIPES.get(rule.recipe)
        if recipe is None:
            continue
        try:
            params = parse_params(recipe, rule.params)
        except ValidationError:
            logger.warning("automation has invalid settings", extra={"recipe": rule.recipe})
            continue
        # A recipe whose advice is optional runs in the AI job only when it asks the AI.
        if asks_ai(recipe, params, ai_on) == ai:
            rules.append((rule, recipe, params))
    if not rules:
        return "no automations switched on"
    if not entitled(ctx.db, company.id):
        return f"{len(rules)} automation(s) paused: the plan doesn't include automations"
    if ai and not ai_on:
        return f"{len(rules)} AI automation(s) paused: AI is switched off"
    language = settings.ai_language if settings else "en"

    ran = failed = 0
    for rule, recipe, params in rules:
        run_key = recipe.schedule(params)(ctx.now, ctx.zone)
        if run_key is None:
            continue
        run_id = claim_run(ctx.db, job_name(recipe.code), company.id, run_key)
        if run_id is None:
            continue
        try:
            context = RecipeContext(db=ctx.db, company=company, now=ctx.now, zone=ctx.zone, language=language, ai=ai_on)
            notices = recipe.build(context, params)
            user_ids = recipient_ids(ctx.db, company.id, recipe, rule.recipients or [])
            new = deliver(ctx.db, company, recipe, notices, user_ids, email=bool(getattr(params, "email", True)))
            actions.track(ctx.db, company, rule, recipe, notices, now=ctx.now)
            ctx.db.commit()
            finish_run(ctx.db, run_id, "succeeded", f"{new} notice(s) to {len(user_ids)} recipient(s)")
            ran += 1
        except RecipeProblem as exc:
            # Set up wrong (a deleted location, say): the owner reads why on the page.
            ctx.db.rollback()
            finish_run(ctx.db, run_id, "failed", str(exc)[:500])
            logger.warning("automation can't run as set up", extra={"recipe": recipe.code})
            failed += 1
        except Exception as exc:
            ctx.db.rollback()
            finish_run(ctx.db, run_id, "failed", f"{type(exc).__name__}: {exc}"[:500])
            logger.exception("automation failed", extra={"recipe": recipe.code})
            failed += 1
    return f"{ran} automation(s) ran, {failed} failed"


# Each AI test is a paid model call: one per recipe per this long.
AI_TEST_COOLDOWN = timedelta(minutes=10)


def send_test(db: Session, company: Company, recipe: Recipe, user: User, *, now: datetime, zone) -> int:
    """Build the recipe as of now and send it to one user only. Commits.

    A test changes no remembered state (RecipeContext.test), and raises
    RecipeProblem when the recipe can't run as set up."""
    rule = db.query(AutomationRule).filter(AutomationRule.recipe == recipe.code).first()
    params = parse_params(recipe, rule.params if rule else None)
    settings = ai_settings(db, company.id)
    ai_on = bool(settings and settings.ai_enabled)
    if recipe.uses_ai and not ai_on:
        raise RecipeProblem("Switch on AI for your automations first, at the top of the AI advisor section.")
    if asks_ai(recipe, params, ai_on):
        recent = (
            db.query(Notification.id)
            .filter(
                Notification.kind == job_name(recipe.code),
                Notification.dedupe_key.like("%:test:%"),
                Notification.created_at >= now - AI_TEST_COOLDOWN,
            )
            .first()
        )
        if recent is not None:
            raise RecipeProblem("Each AI test costs a little. Try this one again in a few minutes.")
    context = RecipeContext(
        db=db,
        company=company,
        now=now,
        zone=zone,
        test=True,
        language=settings.ai_language if settings else "en",
        ai=ai_on,
    )
    notices = recipe.build(context, params)
    new = deliver(
        db,
        company,
        recipe,
        notices,
        [user.id],
        email=bool(getattr(params, "email", True)),
        key_suffix=f":test:{now.isoformat()}",
    )
    db.commit()
    return new
