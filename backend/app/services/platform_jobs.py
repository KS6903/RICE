"""Scheduled upkeep for every plan: reminders before a plan or trial ends, and
purging sign-in records nobody can use any more."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import delete, or_
from sqlalchemy.orm import Session

from ..models.auth_session import AuthSession
from ..models.company import Company
from ..models.password_reset import PasswordResetToken
from ..models.subscription import Subscription, SubscriptionPlan
from ..models.user import Role, User
from .notification_service import notify

REMIND_DAYS_BEFORE = (7, 1)
REMIND_ROLES = ("owner", "admin")


def plan_end(sub: Subscription) -> datetime | None:
    """When the mill loses its plan: the paid period's end, else the trial's."""
    return sub.expires_at or sub.trial_ends_at


def remind_expiring(db: Session, company: Company, *, today: date, zone) -> int:
    """Warn a tenant's owners and admins 7 days and 1 day before its paid plan
    or trial ends. Under the bell and by email. Returns how many notices were
    new; does not commit. A retried or repeated run adds nothing: the dedupe
    key names the subscription, its end date and the warning."""
    sub = db.query(Subscription).filter(Subscription.company_id == company.id).first()
    if sub is None or sub.status not in ("active", "trial"):
        return 0
    ends = plan_end(sub)
    if ends is None:
        return 0
    plan = db.get(SubscriptionPlan, sub.plan_id)
    if plan is None or (sub.status != "trial" and not plan.monthly_price):
        return 0  # the Free plan never ends
    last_day = ends.astimezone(zone).date()
    days_left = (last_day - today).days
    if days_left not in REMIND_DAYS_BEFORE:
        return 0

    queued = db.get(SubscriptionPlan, sub.queued_plan_id) if sub.queued_plan_id else None
    after = f"the {queued.name} plan you chose" if queued else "the Free plan"
    what = f"Your free trial of {plan.name}" if sub.status == "trial" else f"Your {plan.name} plan"
    when = "tomorrow" if days_left == 1 else f"in {days_left} days"
    users = (
        db.query(User)
        .join(Role, Role.id == User.role_id)
        .filter(User.company_id == company.id, User.is_active.is_(True), Role.name.in_(REMIND_ROLES))
        .all()
    )
    return notify(
        db,
        company_id=company.id,
        user_ids=[u.id for u in users],
        kind="subscription.expiring",
        title=f"{what} ends {when}",
        body=(
            f"It ends on {last_day:%A %d %B %Y}. After that, {company.name} moves to {after}, and features "
            f"that need {plan.name} stop working. Renew or change your plan in Settings, under Billing."
        ),
        link="/settings",
        dedupe_key=f"subscription.expiring:{sub.id}:{last_day.isoformat()}:{days_left}",
        email=True,
    )


def health_watch(db: Session, *, now: datetime) -> str:
    """Run the readiness checks from the jobs container and email platform
    admins about each problem, at most once a day per problem."""
    from ..core.health import check
    from ..jobs.runner import claim_run, finish_run
    from . import platform_emails

    result = check(db, now=now)
    checks = result["checks"]
    problems: dict[str, tuple[str, str]] = {}
    if not checks["database"]["ok"]:
        return "database unreachable"  # nothing else can be checked, or emailed
    schema = checks["schema"]
    if not schema["ok"]:
        problems["schema"] = (
            "database schema doesn't match the code",
            f"The database is at {schema['database'] or 'no revision'}; this code expects {schema['code']}. "
            "Run alembic upgrade head and migrate_all_tenants.py with the provisioner credential.",
        )
    if not checks["redis"]["ok"]:
        problems["redis"] = (
            "Redis is unreachable",
            "Rate limits, lockouts and the cache have fallen back to each container's memory.",
        )
    prov = checks["provisioning"]
    if prov["failed_tenants"]:
        problems["provisioning_failed"] = (
            "tenant setup keeps failing",
            f"{prov['failed_tenants']} mill(s) used up their setup retries. Check the provisioner logs, "
            "then press Retry on the tenant in the admin console.",
        )
    elif not prov["ok"]:
        problems["provisioning_stuck"] = (
            "tenant setup is stuck",
            f"A mill has waited {prov['oldest_waiting_minutes']} minutes for its account to be set up.",
        )
    day = now.strftime("%Y-%m-%d")
    for key, (problem, detail) in problems.items():
        run_id = claim_run(db, f"platform.health_watch.{key}", None, day)
        if run_id is not None:
            sent = platform_emails.health_problem(db, problem=problem, detail=detail)
            finish_run(db, run_id, "succeeded", f"{sent} admin(s) emailed")
    return ", ".join(sorted(problems)) or "all healthy"


BUDGET_LEVELS = (90, 70)  # highest first: one email per level per month


def redis_budget(db: Session, *, now: datetime) -> str:
    """Read the month's Redis usage from Upstash and warn platform admins once
    a month as it passes 70% and 90% of the quota. Commits its claims."""
    import httpx

    from ..core.config import settings
    from ..jobs.runner import claim_run, finish_run
    from . import platform_emails

    if not (settings.UPSTASH_API_EMAIL and settings.UPSTASH_API_KEY and settings.UPSTASH_DATABASE_ID):
        return "Upstash API not configured"
    try:
        response = httpx.get(
            f"https://api.upstash.com/v2/redis/stats/{settings.UPSTASH_DATABASE_ID}",
            auth=(settings.UPSTASH_API_EMAIL, settings.UPSTASH_API_KEY.get_secret_value()),
            timeout=15,
        )
        response.raise_for_status()
        used = int(response.json()["total_monthly_requests"])
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(f"Upstash stats unavailable: {type(exc).__name__}") from exc
    limit = max(1, settings.UPSTASH_MONTHLY_REQUEST_LIMIT)
    share = used * 100 // limit
    month = now.strftime("%Y-%m")
    for level in BUDGET_LEVELS:
        if share < level:
            continue
        # job_runs makes the warning once-per-month-per-level, like any run.
        run_id = claim_run(db, f"platform.redis_budget.{level}", None, month)
        if run_id is not None:
            sent = platform_emails.redis_budget(db, used=used, limit=limit, level=level)
            finish_run(db, run_id, "succeeded", f"{sent} admin(s) emailed at {share}%")
        break
    return f"{used:,} of {limit:,} requests this month ({share}%)"


# Unused or spent reset links can go once they've expired. A refresh-token
# session row stays until a month after it expired: refresh-token reuse
# detection needs revoked rows while their tokens could still be presented.
RESET_TOKENS_KEPT_FOR = timedelta(days=1)
SESSIONS_KEPT_FOR = timedelta(days=30)


def purge_auth_records(db: Session, *, now: datetime) -> tuple[int, int]:
    """Delete password-reset tokens past use, and sign-in sessions long expired.
    Returns (tokens, sessions) deleted; does not commit."""
    tokens = db.execute(
        delete(PasswordResetToken).where(
            or_(
                PasswordResetToken.expires_at < now - RESET_TOKENS_KEPT_FOR,
                PasswordResetToken.used_at < now - RESET_TOKENS_KEPT_FOR,
            )
        )
    ).rowcount  # type: ignore[attr-defined]
    sessions = db.execute(delete(AuthSession).where(AuthSession.expires_at < now - SESSIONS_KEPT_FOR)).rowcount  # type: ignore[attr-defined]
    return tokens, sessions
