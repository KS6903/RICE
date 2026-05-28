"""Tenant-facing billing endpoints: view plans, request upgrades."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user, require_roles
from ..models.subscription import SubscriptionPlan, Subscription
from ..models.upgrade_request import UpgradeRequest
from ..services.subscription import effective_status

router = APIRouter()


def _serialize_plan(p: SubscriptionPlan) -> dict:
    return {
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


def _serialize_request(r: UpgradeRequest) -> dict:
    return {
        "id": str(r.id),
        "company_id": str(r.company_id),
        "requested_plan_id": str(r.requested_plan_id),
        "requested_plan_code": r.requested_plan.code if r.requested_plan else None,
        "requested_plan_name": r.requested_plan.name if r.requested_plan else None,
        "current_plan_id": str(r.current_plan_id) if r.current_plan_id else None,
        "current_plan_code": r.current_plan.code if r.current_plan else None,
        "current_plan_name": r.current_plan.name if r.current_plan else None,
        "requested_by": str(r.requested_by) if r.requested_by else None,
        "request_type": r.request_type,
        "status": r.status,
        "note": r.note,
        "admin_note": r.admin_note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
    }


@router.get("/plans")
def list_plans_public(_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Active plans visible to the tenant (for the Billing settings page)."""
    rows = (
        db.query(SubscriptionPlan)
        .filter(SubscriptionPlan.is_active == True)
        .order_by(SubscriptionPlan.sort_order)
        .all()
    )
    return [_serialize_plan(p) for p in rows]


@router.get("/subscription")
def my_subscription(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.company_id:
        return {"subscription": None}
    sub = db.query(Subscription).filter(Subscription.company_id == current_user.company_id).first()
    if not sub or not sub.plan:
        return {"subscription": None}
    return {
        "subscription": {
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
        }
    }


class UpgradeRequestCreate(BaseModel):
    plan_id: uuid.UUID
    note: str | None = None
    request_type: str = "upgrade"  # "upgrade" or "change"


@router.get("/upgrade-requests/mine")
def my_latest_request(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the tenant's current pending request if one exists, otherwise
    the most recent request of any status.

    Why prefer pending: previously this returned the single most-recent row,
    which meant a newly-cancelled request would hide an older still-pending
    one. With the helper that auto-resolves pending requests on plan change,
    that shouldn't happen anymore — but pending-first is the safer contract
    for the UI banner and removes the ambiguity entirely.
    """
    if not current_user.company_id:
        return {"request": None}
    base = db.query(UpgradeRequest).filter(UpgradeRequest.company_id == current_user.company_id)
    r = (
        base.filter(UpgradeRequest.status == "pending")
        .order_by(UpgradeRequest.created_at.desc())
        .first()
        or base.order_by(UpgradeRequest.created_at.desc()).first()
    )
    return {"request": _serialize_request(r) if r else None}


@router.post("/upgrade-requests", status_code=status.HTTP_201_CREATED)
def create_upgrade_request(
    body: UpgradeRequestCreate,
    current_user=Depends(require_roles("owner", "admin")),
    db: Session = Depends(get_db),
):
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="No company on this user")

    plan = db.get(SubscriptionPlan, body.plan_id)
    if not plan or not plan.is_active:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.code == "free":
        raise HTTPException(
            status_code=400,
            detail="Free is the default plan and is assigned automatically when your subscription ends. You can't request it.",
        )

    existing_pending = (
        db.query(UpgradeRequest)
        .filter(
            UpgradeRequest.company_id == current_user.company_id,
            UpgradeRequest.status == "pending",
        )
        .first()
    )
    if existing_pending:
        raise HTTPException(
            status_code=409,
            detail="You already have a pending upgrade request. Cancel it first to request a different plan.",
        )

    current_sub = db.query(Subscription).filter(Subscription.company_id == current_user.company_id).first()
    if current_sub and current_sub.plan_id == plan.id:
        raise HTTPException(status_code=400, detail="You are already on this plan.")

    req = UpgradeRequest(
        company_id=current_user.company_id,
        requested_plan_id=plan.id,
        current_plan_id=current_sub.plan_id if current_sub else None,
        requested_by=current_user.id,
        request_type=body.request_type if body.request_type in ("upgrade", "change") else "upgrade",
        status="pending",
        note=body.note,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return _serialize_request(req)


@router.delete("/upgrade-requests/{request_id}")
def cancel_upgrade_request(
    request_id: uuid.UUID,
    current_user=Depends(require_roles("owner", "admin")),
    db: Session = Depends(get_db),
):
    r = db.get(UpgradeRequest, request_id)
    if not r or r.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Request not found")
    if r.status != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot cancel a request that is already {r.status}.")
    r.status = "cancelled"
    r.resolved_at = datetime.now(timezone.utc)
    r.resolved_by = current_user.id
    db.commit()
    return {"message": "Request cancelled"}
