"""Subscription helpers shared across signup, auth, admin, and billing."""
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..core.security import invalidate_company_features
from ..models.subscription import Subscription, SubscriptionPlan
from ..models.upgrade_request import UpgradeRequest

ACTIVE_STATUSES = ("active", "trial")


def effective_status(sub: Subscription | None) -> str | None:
    """Return the status a subscription should be treated as right now.

    Returns "expired" when expires_at is in the past and the stored status is
    active/trial. Pure function — does not write to the DB."""
    if sub is None:
        return None
    if sub.status in ACTIVE_STATUSES and sub.expires_at is not None:
        if sub.expires_at < datetime.now(timezone.utc):
            return "expired"
    return sub.status


def is_active(sub: Subscription | None) -> bool:
    return effective_status(sub) in ACTIVE_STATUSES


def get_free_plan(db: Session) -> SubscriptionPlan | None:
    return db.query(SubscriptionPlan).filter(SubscriptionPlan.code == "free").first()


def resolve_pending_upgrade_requests(
    db: Session,
    company_id: uuid.UUID,
    new_plan_id: uuid.UUID,
    admin_id: uuid.UUID | None = None,
    auto_note: str = "Resolved automatically when admin set the tenant's plan.",
) -> int:
    """Resolve any pending upgrade requests for a company when its plan changes
    outside the normal approve/reject flow.

    Why: when an admin changes a tenant's plan via the tenant-detail page (or
    a subscription sweep), pending requests would otherwise be left stranded —
    the admin's upgrade inbox keeps showing the request, while the tenant has
    already moved on. This reconciles the two.

    Behavior: if the pending request asked for the same plan the company is
    now on, mark it 'approved'. Otherwise mark it 'cancelled'. Either way we
    set resolved_at and admin_note so the tenant gets a clear status update.

    Returns the number of requests resolved.
    """
    pending = (
        db.query(UpgradeRequest)
        .filter(
            UpgradeRequest.company_id == company_id,
            UpgradeRequest.status == "pending",
        )
        .all()
    )
    if not pending:
        return 0
    now = datetime.now(timezone.utc)
    for r in pending:
        r.status = "approved" if r.requested_plan_id == new_plan_id else "cancelled"
        r.resolved_at = now
        r.resolved_by = admin_id
        if not r.admin_note:
            r.admin_note = auto_note
    db.flush()
    return len(pending)


def ensure_subscription(db: Session, company_id: uuid.UUID) -> Subscription | None:
    """Return the company's subscription, creating a Free-plan active row if missing.

    Returns None only when no Free plan exists in the database (mis-seeded DB)."""
    sub = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    if sub:
        return sub
    free_plan = get_free_plan(db)
    if not free_plan:
        return None
    from datetime import time as dt_time
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    expiry_day = (now + timedelta(days=30)).date()
    expires_at = datetime.combine(expiry_day, dt_time(23, 59, 59), tzinfo=timezone.utc)
    sub = Subscription(
        company_id=company_id,
        plan_id=free_plan.id,
        status="active",
        expires_at=expires_at,
    )
    db.add(sub)
    db.flush()
    invalidate_company_features(company_id)
    return sub


def activate_subscription(
    db: Session,
    company_id: uuid.UUID,
    plan_id: uuid.UUID,
    admin_id: uuid.UUID | None = None,
    expires_at: datetime | None = None,
    notes: str | None = None,
) -> Subscription:
    """Start a clean active subscription period for a company.

    Why: every "activate" path (admin PUT, admin POST .../activate, upgrade-request
    approve) must leave the row in a consistent state. Previously these scattered
    updates would leave stale `expires_at` or `trial_ends_at` from a prior trial,
    so effective_status() would immediately re-flip the sub to "expired".

    Always sets: status='active', started_at=now, trial_ends_at=None.
    expires_at=None means a permanent subscription.
    """
    now = datetime.now(timezone.utc)
    sub = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    if sub:
        sub.plan_id = plan_id
        sub.status = "active"
        sub.started_at = now
        sub.expires_at = expires_at
        sub.trial_ends_at = None
        if notes is not None:
            sub.notes = notes
        if admin_id is not None:
            sub.updated_by = admin_id
    else:
        sub = Subscription(
            company_id=company_id,
            plan_id=plan_id,
            status="active",
            started_at=now,
            expires_at=expires_at,
            trial_ends_at=None,
            notes=notes,
            updated_by=admin_id,
        )
        db.add(sub)
    db.flush()
    invalidate_company_features(company_id)
    return sub


def auto_downgrade_to_free_if_expired(db: Session, company_id: uuid.UUID) -> Subscription | None:
    """If this company's paid (active/trial) subscription has passed its expires_at,
    move them to the Free plan instead of leaving them in a locked-out state.

    Why: a SaaS where paid plans silently fall back to Free on expiry is friendlier
    than one that locks users out. Admin-set "expired"/"cancelled"/"past_due" are
    deliberate revocations and are NOT auto-downgraded here.

    Returns the updated (or unchanged) subscription, or None if no row exists.
    Safe to call on every /auth/me poll — only writes when an actual transition
    happens.
    """
    sub = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    if not sub:
        return None
    if sub.status not in ACTIVE_STATUSES:
        return sub
    if sub.expires_at is None:
        return sub
    if sub.expires_at >= datetime.now(timezone.utc):
        return sub

    free_plan = get_free_plan(db)
    if not free_plan:
        # No Free plan to downgrade to — fall back to legacy behavior so the
        # caller at least sees a consistent "expired" status.
        sub.status = "expired"
        db.commit()
        invalidate_company_features(company_id)
        return sub

    if sub.plan_id == free_plan.id:
        # Free plan with an expiry that has passed — just clear the expiry so it
        # stops being treated as expired.
        sub.expires_at = None
        db.commit()
        invalidate_company_features(company_id)
        return sub

    # If a plan change was queued, activate it now instead of downgrading to Free.
    target_plan_id = sub.queued_plan_id if sub.queued_plan_id else free_plan.id
    target_note = (
        "Queued plan change applied — subscription moved to new plan on expiry"
        if sub.queued_plan_id
        else f"Auto-downgraded from '{sub.plan.code if sub.plan else 'paid'}' on expiry"
    )
    sub.queued_plan_id = None
    activate_subscription(
        db,
        company_id=company_id,
        plan_id=target_plan_id,
        admin_id=None,
        expires_at=None,
        notes=target_note,
    )
    resolve_pending_upgrade_requests(
        db,
        company_id=company_id,
        new_plan_id=target_plan_id,
        admin_id=None,
        auto_note=(
            "Applied: your plan change took effect when your previous subscription expired."
            if target_plan_id != free_plan.id
            else "Cancelled: your subscription expired and was downgraded to Free."
        ),
    )
    db.commit()
    return sub


def sweep_expired(db: Session) -> int:
    """Auto-downgrade every paid (active/trial) subscription whose expires_at has
    passed back to the Free plan. Returns the number of subscriptions migrated."""
    now = datetime.now(timezone.utc)
    rows = (
        db.query(Subscription)
        .filter(
            Subscription.status.in_(ACTIVE_STATUSES),
            Subscription.expires_at.is_not(None),
            Subscription.expires_at < now,
        )
        .all()
    )
    free_plan = get_free_plan(db)
    if not free_plan:
        # No Free plan seeded — fall back to marking as expired.
        for r in rows:
            r.status = "expired"
        if rows:
            db.commit()
        for r in rows:
            invalidate_company_features(r.company_id)
        return len(rows)

    migrated = 0
    for r in rows:
        if r.plan_id == free_plan.id:
            r.expires_at = None
            invalidate_company_features(r.company_id)
            migrated += 1
            continue
        target_plan_id = r.queued_plan_id if r.queued_plan_id else free_plan.id
        r.queued_plan_id = None
        activate_subscription(
            db,
            company_id=r.company_id,
            plan_id=target_plan_id,
            admin_id=None,
            expires_at=None,
            notes=(
                "Queued plan change applied on expiry sweep"
                if target_plan_id != free_plan.id
                else f"Auto-downgraded from '{r.plan.code if r.plan else 'paid'}' on expiry sweep"
            ),
        )
        resolve_pending_upgrade_requests(
            db,
            company_id=r.company_id,
            new_plan_id=target_plan_id,
            admin_id=None,
            auto_note=(
                "Applied: your plan change took effect when your previous subscription expired."
                if target_plan_id != free_plan.id
                else "Cancelled: subscription expired during the expiry sweep."
            ),
        )
        migrated += 1
    if rows:
        db.commit()
    return migrated


def backfill_free(db: Session) -> int:
    """Assign Free plan to every company missing a subscription. Returns count assigned."""
    from ..models.company import Company

    free_plan = get_free_plan(db)
    if not free_plan:
        return 0

    missing = (
        db.query(Company)
        .outerjoin(Subscription, Subscription.company_id == Company.id)
        .filter(Subscription.id.is_(None))
        .all()
    )
    for c in missing:
        db.add(Subscription(company_id=c.id, plan_id=free_plan.id, status="active"))
    if missing:
        db.commit()
    return len(missing)
