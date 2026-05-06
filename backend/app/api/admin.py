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

router = APIRouter()


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
    return {
        "company_id": str(tenant_id),
        "subscription": {
            "id": str(sub.id),
            "plan_id": str(sub.plan.id),
            "plan_code": sub.plan.code,
            "plan_name": sub.plan.name,
            "monthly_price": float(sub.plan.monthly_price),
            "features": list(sub.plan.features or []),
            "max_users": sub.plan.max_users,
            "max_branches": sub.plan.max_branches,
            "status": sub.status,
            "started_at": sub.started_at.isoformat() if sub.started_at else None,
            "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
            "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
            "notes": sub.notes,
        },
    }


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

    sub = db.query(Subscription).filter(Subscription.company_id == tenant_id).first()
    if sub:
        sub.plan_id = plan.id
        sub.status = body.status
        sub.expires_at = body.expires_at
        sub.trial_ends_at = body.trial_ends_at
        if body.notes is not None:
            sub.notes = body.notes
        sub.updated_by = admin.id
    else:
        sub = Subscription(
            company_id=company.id,
            plan_id=plan.id,
            status=body.status,
            expires_at=body.expires_at,
            trial_ends_at=body.trial_ends_at,
            notes=body.notes,
            updated_by=admin.id,
        )
        db.add(sub)

    db.commit()
    return {"message": f"Tenant '{company.name}' is now on the '{plan.name}' plan", "plan_code": plan.code}


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

    return {
        "total_tenants": total_tenants,
        "total_branches": total_branches,
        "total_users": total_users,
        "total_purchases": total_purchases,
        "total_batches": total_batches,
        "total_orders": total_orders,
        "new_tenants_30d": new_tenants_30d,
        "active_users_7d": active_users_7d,
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
            "plan_code": sub_by_company.get(c.id).plan.code if sub_by_company.get(c.id) and sub_by_company.get(c.id).plan else None,
            "plan_name": sub_by_company.get(c.id).plan.name if sub_by_company.get(c.id) and sub_by_company.get(c.id).plan else None,
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
