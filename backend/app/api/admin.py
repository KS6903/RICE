"""Platform admin (SaaS owner) endpoints. Require is_platform_admin=True."""
import uuid
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import require_platform_admin
from ..models.company import Company, Branch
from ..models.user import User, Role
from ..models.paddy import PalayPurchase
from ..models.milling import MillingBatch
from ..models.sales import SalesOrder, Invoice
from ..models.costs import Expense
from ..models.subscription import SubscriptionPlan, Subscription
from ..models.upgrade_request import UpgradeRequest
from ..services.subscription import (
    effective_status,
    sweep_expired,
    backfill_free,
    activate_subscription,
    resolve_pending_upgrade_requests,
)

router = APIRouter()
ALLOWED_SUB_STATUSES = {"active", "trial", "past_due", "cancelled", "expired"}


def _subscription_payload(sub: Subscription) -> dict:
    return {
        "id": str(sub.id),
        "plan_id": str(sub.plan.id),
        "plan_code": sub.plan.code,
        "plan_name": sub.plan.name,
        "monthly_price": float(sub.plan.monthly_price),
        "features": list(sub.plan.features or []),
        "max_users": sub.plan.max_users,
        "max_branches": sub.plan.max_branches,
        "status": effective_status(sub) or sub.status,
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
        "notes": sub.notes,
    }


@router.get("/plans")
def list_plans(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    rows = db.query(SubscriptionPlan).order_by(SubscriptionPlan.sort_order).all()
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "description": p.description,
            "monthly_price": float(p.monthly_price),
            "max_users": p.max_users,
            "max_branches": p.max_branches,
            "features": list(p.features or []),
            "is_active": p.is_active,
            "sort_order": p.sort_order,
        }
        for p in rows
    ]


@router.get("/tenants/{tenant_id}/subscription")
def get_tenant_subscription(tenant_id: uuid.UUID, _admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    company = db.get(Company, tenant_id)
    if not company:
        raise HTTPException(status_code=404, detail="Tenant not found")
    sub = db.query(Subscription).filter(Subscription.company_id == tenant_id).first()
    if not sub or not sub.plan:
        return {"company_id": str(tenant_id), "subscription": None}
    return {"company_id": str(tenant_id), "subscription": _subscription_payload(sub)}


class SubscriptionAssign(BaseModel):
    plan_id: uuid.UUID
    status: str = "active"          # active, trial, past_due, cancelled, expired
    expires_at: datetime | None = None
    trial_ends_at: datetime | None = None
    notes: str | None = None


@router.put("/tenants/{tenant_id}/subscription")
def assign_tenant_subscription(
    tenant_id: uuid.UUID,
    body: SubscriptionAssign,
    admin=Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = db.get(Company, tenant_id)
    if not company:
        raise HTTPException(status_code=404, detail="Tenant not found")
    plan = db.get(SubscriptionPlan, body.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    normalized_status = body.status.strip().lower()
    if normalized_status not in ALLOWED_SUB_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid subscription status: '{body.status}'")

    if normalized_status == "active":
        # Route through the shared helper so started_at is reset and any stale
        # trial_ends_at from a prior trial is cleared.
        sub = activate_subscription(
            db,
            company_id=company.id,
            plan_id=plan.id,
            admin_id=admin.id,
            expires_at=body.expires_at,
            notes=body.notes,
        )
    else:
        sub = db.query(Subscription).filter(Subscription.company_id == tenant_id).first()
        if sub:
            sub.plan_id = plan.id
            sub.status = normalized_status
            sub.expires_at = body.expires_at
            sub.trial_ends_at = body.trial_ends_at
            if body.notes is not None:
                sub.notes = body.notes
            sub.updated_by = admin.id
        else:
            sub = Subscription(
                company_id=company.id,
                plan_id=plan.id,
                status=normalized_status,
                expires_at=body.expires_at,
                trial_ends_at=body.trial_ends_at,
                notes=body.notes,
                updated_by=admin.id,
            )
            db.add(sub)

    # Reconcile pending upgrade requests so the admin inbox and the tenant's
    # billing page don't show a stale "awaiting approval" banner after the
    # admin has already set the plan directly.
    resolve_pending_upgrade_requests(db, company.id, plan.id, admin_id=admin.id)

    db.commit()
    db.refresh(sub)
    return {
        "message": f"Tenant '{company.name}' is now on the '{plan.name}' plan",
        "plan_code": plan.code,
        "subscription": _subscription_payload(sub),
    }


class SubscriptionActivate(BaseModel):
    plan_id: uuid.UUID | None = None
    notes: str | None = None
    clear_expiry: bool = True


@router.post("/tenants/{tenant_id}/subscription/activate")
def activate_tenant_subscription(
    tenant_id: uuid.UUID,
    body: SubscriptionActivate,
    admin=Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = db.get(Company, tenant_id)
    if not company:
        raise HTTPException(status_code=404, detail="Tenant not found")

    chosen_plan: SubscriptionPlan | None = None
    if body.plan_id is not None:
        chosen_plan = db.get(SubscriptionPlan, body.plan_id)
        if not chosen_plan:
            raise HTTPException(status_code=404, detail="Plan not found")

    existing = db.query(Subscription).filter(Subscription.company_id == tenant_id).first()
    if chosen_plan is None:
        # Keep current plan if there is one; otherwise fall back to Free.
        if existing and existing.plan:
            chosen_plan = existing.plan
        else:
            chosen_plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.code == "free").first()
            if not chosen_plan:
                raise HTTPException(status_code=500, detail="No default plan found (missing 'free' plan)")

    # Preserve a future expires_at unless the caller asked to clear it.
    keep_expiry = (
        not body.clear_expiry
        and existing is not None
        and existing.expires_at is not None
    )
    expires_at = existing.expires_at if keep_expiry else None

    sub = activate_subscription(
        db,
        company_id=company.id,
        plan_id=chosen_plan.id,
        admin_id=admin.id,
        expires_at=expires_at,
        notes=body.notes,
    )

    resolve_pending_upgrade_requests(db, company.id, chosen_plan.id, admin_id=admin.id)

    db.commit()
    db.refresh(sub)
    return {
        "message": f"Subscription activated for tenant '{company.name}'",
        "subscription": _subscription_payload(sub),
    }


@router.get("/stats")
def platform_stats(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    total_tenants = db.query(func.count(Company.id)).scalar() or 0
    total_branches = db.query(func.count(Branch.id)).scalar() or 0
    total_users = db.query(func.count(User.id)).filter(User.is_platform_admin == False).scalar() or 0
    total_purchases = db.query(func.count(PalayPurchase.id)).scalar() or 0
    total_batches = db.query(func.count(MillingBatch.id)).scalar() or 0
    total_orders = db.query(func.count(SalesOrder.id)).scalar() or 0

    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    new_tenants_30d = db.query(func.count(Company.id)).filter(Company.created_at >= thirty_days_ago).scalar() or 0

    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active_users_7d = db.query(func.count(User.id)).filter(
        User.is_platform_admin == False,
        User.last_login >= seven_days_ago,
    ).scalar() or 0

    now = datetime.now(timezone.utc)
    # "Subscribed" = paying tenant: active/trial status on a paid plan.
    # Free plan is the default fallback and does not count as a paying subscriber.
    paid_company_ids = {
        s.company_id for s in db.query(Subscription).join(SubscriptionPlan).all()
        if s.status in ("active", "trial")
        and (s.expires_at is None or s.expires_at > now)
        and s.plan is not None
        and s.plan.code != "free"
    }
    subscribed_users = db.query(func.count(User.id)).filter(
        User.is_platform_admin == False,
        User.company_id.in_(paid_company_ids),
    ).scalar() or 0
    unsubscribed_users = db.query(func.count(User.id)).filter(
        User.is_platform_admin == False,
        User.company_id.not_in(paid_company_ids) if paid_company_ids else True,
    ).scalar() or 0

    return {
        "total_tenants": total_tenants,
        "total_branches": total_branches,
        "total_users": total_users,
        "total_purchases": total_purchases,
        "total_batches": total_batches,
        "total_orders": total_orders,
        "new_tenants_30d": new_tenants_30d,
        "active_users_7d": active_users_7d,
        "subscribed_users": subscribed_users,
        "unsubscribed_users": unsubscribed_users,
    }


@router.get("/signups-trend")
def signups_trend(days: int = 30, _admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Daily new tenant signups for the last N days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        db.query(
            func.date(Company.created_at).label("date"),
            func.count(Company.id).label("count"),
        )
        .filter(Company.created_at >= cutoff)
        .group_by(func.date(Company.created_at))
        .order_by(func.date(Company.created_at))
        .all()
    )
    return [{"date": r.date.isoformat(), "count": r.count} for r in rows]


@router.get("/tenants")
def list_tenants(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    """All companies with summary metadata."""
    companies = db.query(Company).order_by(Company.created_at.desc()).all()

    user_counts = dict(db.query(User.company_id, func.count(User.id)).group_by(User.company_id).all())
    branch_counts = dict(db.query(Branch.company_id, func.count(Branch.id)).group_by(Branch.company_id).all())
    purchase_counts = dict(db.query(PalayPurchase.company_id, func.count(PalayPurchase.id)).group_by(PalayPurchase.company_id).all())
    order_counts = dict(db.query(SalesOrder.company_id, func.count(SalesOrder.id)).group_by(SalesOrder.company_id).all())
    subs = db.query(Subscription).all()
    sub_by_company = {s.company_id: s for s in subs}

    def _sub_block(cid):
        s = sub_by_company.get(cid)
        if not s or not s.plan:
            return {
                "plan_code": None,
                "plan_name": None,
                "subscription_status": None,
                "started_at": None,
                "expires_at": None,
                "has_subscription": False,
            }
        return {
            "plan_code": s.plan.code,
            "plan_name": s.plan.name,
            "subscription_status": effective_status(s) or s.status,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "has_subscription": True,
        }

    return [
        {
            "id": str(c.id),
            "name": c.name,
            "tin": c.tin,
            "phone": c.phone,
            "email": c.email,
            "is_multi_branch": c.is_multi_branch,
            "is_active": c.is_active,
            "currency": c.currency,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "users_count": user_counts.get(c.id, 0),
            "branches_count": branch_counts.get(c.id, 0),
            "purchases_count": purchase_counts.get(c.id, 0),
            "orders_count": order_counts.get(c.id, 0),
            **_sub_block(c.id),
        }
        for c in companies
    ]


@router.get("/tenants/{tenant_id}")
def get_tenant(tenant_id: uuid.UUID, _admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    company = db.get(Company, tenant_id)
    if not company:
        raise HTTPException(status_code=404, detail="Tenant not found")

    users = db.query(User).filter(User.company_id == company.id).all()
    branches = db.query(Branch).filter(Branch.company_id == company.id).all()
    purchases = db.query(func.count(PalayPurchase.id)).filter(PalayPurchase.company_id == company.id).scalar() or 0
    batches = db.query(func.count(MillingBatch.id)).filter(MillingBatch.company_id == company.id).scalar() or 0
    orders = db.query(func.count(SalesOrder.id)).filter(SalesOrder.company_id == company.id).scalar() or 0
    invoices = db.query(func.count(Invoice.id)).filter(Invoice.company_id == company.id).scalar() or 0
    expenses_total = db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(Expense.company_id == company.id).scalar() or 0
    revenue_total = db.query(func.coalesce(func.sum(SalesOrder.total_amount), 0)).filter(
        SalesOrder.company_id == company.id,
        SalesOrder.status.in_(["invoiced", "paid"]),
    ).scalar() or 0

    return {
        "company": {
            "id": str(company.id),
            "name": company.name,
            "address": company.address,
            "tin": company.tin,
            "nfa_license_no": company.nfa_license_no,
            "da_registration_no": company.da_registration_no,
            "phone": company.phone,
            "email": company.email,
            "currency": company.currency,
            "timezone": company.timezone,
            "is_multi_branch": company.is_multi_branch,
            "is_active": company.is_active,
            "created_at": company.created_at.isoformat() if company.created_at else None,
        },
        "users": [
            {
                "id": str(u.id),
                "username": u.username,
                "full_name": u.full_name,
                "email": u.email,
                "role": u.role.name if u.role else None,
                "is_active": u.is_active,
                "last_login": u.last_login.isoformat() if u.last_login else None,
            }
            for u in users
        ],
        "branches": [{"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch, "is_active": b.is_active} for b in branches],
        "metrics": {
            "purchases_count": purchases,
            "batches_count": batches,
            "orders_count": orders,
            "invoices_count": invoices,
            "total_expenses": float(expenses_total),
            "total_revenue": float(revenue_total),
        },
    }


class TenantActiveToggle(BaseModel):
    is_active: bool


@router.put("/tenants/{tenant_id}/active")
def set_tenant_active(tenant_id: uuid.UUID, body: TenantActiveToggle, _admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Activate or deactivate a tenant. When inactive, all their users are blocked from login."""
    company = db.get(Company, tenant_id)
    if not company:
        raise HTTPException(status_code=404, detail="Tenant not found")
    company.is_active = body.is_active
    db.commit()
    return {
        "message": f"Tenant '{company.name}' is now {'active' if body.is_active else 'inactive'}",
        "is_active": company.is_active,
    }


@router.get("/users")
def list_all_users(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    """All users across all tenants (excludes platform admins)."""
    users = (
        db.query(User)
        .filter(User.is_platform_admin == False)
        .order_by(User.created_at.desc() if hasattr(User, "created_at") else User.id)
        .all()
    )
    company_names = dict(db.query(Company.id, Company.name).all())
    return [
        {
            "id": str(u.id),
            "username": u.username,
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role.name if u.role else None,
            "is_active": u.is_active,
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "company_id": str(u.company_id) if u.company_id else None,
            "company_name": company_names.get(u.company_id) if u.company_id else None,
        }
        for u in users
    ]


# ─────────────────────────── Subscription maintenance ───────────────────────────

@router.post("/subscriptions/sweep-expired")
def sweep_expired_subscriptions(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Persist status='expired' for any active/trial subs whose expires_at is past."""
    count = sweep_expired(db)
    return {"message": f"Marked {count} subscription(s) as expired", "expired": count}


@router.post("/subscriptions/backfill-free")
def backfill_free_subscriptions(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Assign the Free plan to every tenant currently missing a subscription."""
    count = backfill_free(db)
    return {"message": f"Backfilled Free plan for {count} tenant(s)", "backfilled": count}


@router.get("/subscriptions/missing-count")
def missing_subscription_count(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    """Number of tenants without any subscription row. Drives the 'Fix N tenants' admin nudge."""
    count = (
        db.query(func.count(Company.id))
        .outerjoin(Subscription, Subscription.company_id == Company.id)
        .filter(Subscription.id.is_(None))
        .scalar()
    ) or 0
    return {"missing": int(count)}


# ─────────────────────────── Upgrade-request inbox ───────────────────────────

def _serialize_upgrade_request_row(r: UpgradeRequest, company_names: dict) -> dict:
    return {
        "id": str(r.id),
        "company_id": str(r.company_id),
        "company_name": company_names.get(r.company_id),
        "requested_plan_id": str(r.requested_plan_id),
        "requested_plan_code": r.requested_plan.code if r.requested_plan else None,
        "requested_plan_name": r.requested_plan.name if r.requested_plan else None,
        "current_plan_id": str(r.current_plan_id) if r.current_plan_id else None,
        "current_plan_code": r.current_plan.code if r.current_plan else None,
        "current_plan_name": r.current_plan.name if r.current_plan else None,
        "status": r.status,
        "note": r.note,
        "admin_note": r.admin_note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
    }


@router.get("/upgrade-requests")
def list_upgrade_requests(
    status_filter: str | None = "pending",
    _admin=Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    q = db.query(UpgradeRequest).order_by(UpgradeRequest.created_at.desc())
    if status_filter and status_filter != "all":
        q = q.filter(UpgradeRequest.status == status_filter)
    rows = q.all()
    company_names = dict(db.query(Company.id, Company.name).all())
    return [_serialize_upgrade_request_row(r, company_names) for r in rows]


@router.get("/upgrade-requests/pending-count")
def pending_upgrade_request_count(_admin=Depends(require_platform_admin), db: Session = Depends(get_db)):
    count = db.query(func.count(UpgradeRequest.id)).filter(UpgradeRequest.status == "pending").scalar() or 0

    # Surface the most recent pending request so the client can toast a
    # "new request from X" notification without a second round-trip.
    latest = (
        db.query(UpgradeRequest)
        .filter(UpgradeRequest.status == "pending")
        .order_by(UpgradeRequest.created_at.desc())
        .first()
    )
    latest_payload = None
    if latest:
        company_name = db.query(Company.name).filter(Company.id == latest.company_id).scalar()
        latest_payload = {
            "id": str(latest.id),
            "company_id": str(latest.company_id),
            "company_name": company_name,
            "requested_plan_name": latest.requested_plan.name if latest.requested_plan else None,
            "requested_plan_code": latest.requested_plan.code if latest.requested_plan else None,
            "created_at": latest.created_at.isoformat() if latest.created_at else None,
        }

    return {"pending": int(count), "latest": latest_payload}


class UpgradeRequestResolution(BaseModel):
    admin_note: str | None = None


@router.post("/upgrade-requests/{request_id}/approve")
def approve_upgrade_request(
    request_id: uuid.UUID,
    body: UpgradeRequestResolution,
    admin=Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    r = db.get(UpgradeRequest, request_id)
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    if r.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {r.status}")

    plan = db.get(SubscriptionPlan, r.requested_plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Requested plan no longer exists")

    is_plan_change = r.request_type == "change"

    if is_plan_change:
        # Queue the plan — apply it only when the current subscription expires.
        from ..models.subscription import Subscription as Sub
        sub = db.query(Sub).filter(Sub.company_id == r.company_id).first()
        if sub and sub.status in ("active", "trial"):
            sub.queued_plan_id = plan.id
        else:
            # Subscription already expired — activate immediately.
            activate_subscription(db, company_id=r.company_id, plan_id=plan.id, admin_id=admin.id)
    else:
        # Standard upgrade — activate right away.
        activate_subscription(db, company_id=r.company_id, plan_id=plan.id, admin_id=admin.id)

    r.status = "approved"
    r.admin_note = body.admin_note
    r.resolved_at = datetime.now(timezone.utc)
    r.resolved_by = admin.id
    resolve_pending_upgrade_requests(db, r.company_id, plan.id, admin_id=admin.id)
    db.commit()
    msg = (
        f"Plan change queued — {plan.name} will activate when current subscription expires."
        if is_plan_change
        else f"Upgrade approved — tenant moved to {plan.name}"
    )
    return {"message": msg}


@router.post("/upgrade-requests/{request_id}/reject")
def reject_upgrade_request(
    request_id: uuid.UUID,
    body: UpgradeRequestResolution,
    admin=Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    r = db.get(UpgradeRequest, request_id)
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    if r.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {r.status}")
    r.status = "rejected"
    r.admin_note = body.admin_note
    r.resolved_at = datetime.now(timezone.utc)
    r.resolved_by = admin.id
    db.commit()
    return {"message": "Upgrade request rejected"}
