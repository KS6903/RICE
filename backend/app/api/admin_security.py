"""BossAdmin's confirmation, "View as", the page directory, vouchers and its
own audit log (core/admin_guard.py, core/view_as.py, core/releases.py,
services/vouchers.py).

``unguarded`` holds what opens the confirmation window or checks itself (the
confirmation, "View as"); ``router`` is under the window like the rest of
/api/admin (api/admin.py): reads pass, changes need a live confirmation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..core import admin_guard, discord, releases, view_as
from ..core.access_policy import ALL_SECTIONS
from ..core.admin_guard import require_admin_confirmed
from ..core.config import settings
from ..core.database import get_db
from ..core.exceptions import BadRequestError, ConflictError, NotFoundError, PermissionDeniedError
from ..core.ratelimit import client_ip, limiter
from ..core.security import require_platform_admin
from ..models.company import Company
from ..models.platform import AdminAuditLog, PageRelease
from ..models.subscription import SubscriptionPlan
from ..models.user import User
from ..models.voucher import Voucher, VoucherRedemption
from ..services import vouchers
from ..services.activity import log_activity
from ..services.auth_service import AuthService

unguarded = APIRouter()
router = APIRouter(dependencies=[Depends(require_admin_confirmed)])


class Proof(BaseModel):
    current_password: str | None = Field(None, max_length=72)
    mfa_code: str | None = Field(None, max_length=12)


def _service(request: Request, db: Session, admin) -> AuthService:
    return AuthService(db, admin, client=request.headers.get("user-agent"), ip=client_ip(request))


# ── confirmation ─────────────────────────────────────────────────────────────


@unguarded.get("/confirm")
def confirm_status(request: Request, admin=Depends(require_platform_admin)):
    live = admin_guard.confirmed(admin, admin_guard.request_sid(request))
    return {
        "confirmed_until": admin.admin_confirmed_until.isoformat() if live else None,
        "uses_code": bool(admin.mfa_enabled),
        "minutes": settings.ADMIN_CONFIRM_MINUTES,
    }


@unguarded.post("/confirm")
@limiter.limit("10/15minutes")
def confirm(
    request: Request,
    response: Response,
    body: Proof,
    db: Session = Depends(get_db),
    admin=Depends(require_platform_admin),
):
    """The password, and the authenticator code with two-factor on: opens the
    window for changes on this sign-in only."""
    sid = admin_guard.request_sid(request)
    if not sid:
        raise PermissionDeniedError("Sign in again to confirm.")
    _service(request, db, admin).confirm_identity(body.current_password, body.mfa_code, reason="BossAdmin changes")
    until = admin_guard.open_window(admin, sid)
    db.commit()
    admin_guard.record(admin_id=admin.id, admin_username=admin.username, action="admin.confirmed", request=request)
    return {"confirmed_until": until.isoformat()}


@unguarded.delete("/confirm")
def end_confirmation(request: Request, db: Session = Depends(get_db), admin=Depends(require_platform_admin)):
    """Close the window now (the console's lock button)."""
    admin_guard.close_window(admin)
    db.commit()
    return {"confirmed_until": None}


# ── View as ──────────────────────────────────────────────────────────────────


class ViewAsStart(Proof):
    user_id: uuid.UUID
    mode: str = "view"


@unguarded.post("/view-as")
@limiter.limit("30/hour")
def start_view_as(
    request: Request,
    response: Response,
    body: ViewAsStart,
    db: Session = Depends(get_db),
    admin=Depends(require_platform_admin),
):
    """Open a mill as one of its people (core/view_as.py). Read-only needs the
    confirmation window; full control needs the password and an authenticator
    code typed right here, every time."""
    mode = body.mode if body.mode in view_as.MODES else "view"
    sid = admin_guard.request_sid(request)
    if not sid:
        raise PermissionDeniedError("Sign in again to continue.")
    target = (
        db.query(User).options(joinedload(User.company), joinedload(User.role)).filter(User.id == body.user_id).first()
    )
    if target is None or target.is_platform_admin or target.company is None:
        raise NotFoundError("User not found")
    if not target.is_active:
        raise BadRequestError("This person was removed from their mill.")
    if target.company.provisioned_at is None:
        raise BadRequestError("This mill isn't set up yet.")
    if mode == "full":
        if not admin.mfa_enabled:
            raise BadRequestError("Turn on two-factor for BossAdmin before taking full control.")
        _service(request, db, admin).confirm_identity(
            body.current_password, body.mfa_code, reason="View as, full control"
        )
        admin_guard.open_window(admin, sid)
    elif not admin_guard.confirmed(admin, sid):
        raise PermissionDeniedError("Confirm it's you to make changes in BossAdmin.", code=admin_guard.CONFIRM_REQUIRED)

    token, expires = view_as.mint(target, admin, sid, mode)
    # The mill can see that BossAdmin looked, in its own activity log.
    from ..core.tenancy import schema_name_for, set_search_path

    set_search_path(db, schema_name_for(target.company))
    log_activity(
        db,
        company_id=target.company.id,
        user_id=None,
        action="bossadmin.view_as",
        entity_type="user",
        entity_id=target.id,
        entity_label=target.username,
        detail=("Full control" if mode == "full" else "Read-only") + f" visit by BossAdmin ({admin.username}).",
    )
    db.commit()
    set_search_path(db, None)
    view_as.set_cookie(response, token, mode)

    who = f"{target.full_name or target.username} (@{target.username})"
    admin_guard.record(
        admin_id=admin.id,
        admin_username=admin.username,
        action="view_as.start",
        request=request,
        company_id=target.company_id,
        detail=f"{mode} as {who} until {expires.isoformat()}",
    )
    admin_guard.alert(
        f"BossAdmin opened {target.company.name} ({'FULL CONTROL' if mode == 'full' else 'read-only'})",
        request=request,
        fields=[("As", who), ("Ends", expires.strftime("%Y-%m-%d %H:%M UTC"))],
        color=discord.RED if mode == "full" else discord.AMBER,
    )
    return {"mode": mode, "expires_at": expires.isoformat(), "company_name": target.company.name}


# ── audit log ────────────────────────────────────────────────────────────────


@router.get("/audit-log")
def audit_log(limit: int = 200, company_id: uuid.UUID | None = None, db: Session = Depends(get_db)):
    query = db.query(AdminAuditLog)
    if company_id is not None:
        query = query.filter(AdminAuditLog.company_id == company_id)
    rows = query.order_by(AdminAuditLog.created_at.desc()).limit(max(1, min(limit, 500))).all()
    names = {c.id: c.name for c in db.query(Company.id, Company.name)}
    return [
        {
            "id": str(r.id),
            "admin_username": r.admin_username,
            "action": r.action,
            "method": r.method,
            "path": r.path,
            "company_id": str(r.company_id) if r.company_id else None,
            "company_name": names.get(r.company_id) if r.company_id else None,
            "detail": r.detail,
            "ip_address": r.ip_address,
            "user_agent": r.user_agent,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ── page directory: release stages and per-mill switches ─────────────────────


class StageUpdate(BaseModel):
    stage: str


class TenantPageUpdate(BaseModel):
    section: str
    # "on", "off", or "default" to follow the release stage again.
    value: str


def _pages_payload(db: Session) -> dict:
    stages = releases.stages(db)
    overrides: dict[str, dict[str, list[dict]]] = {s: {"on": [], "off": []} for s in releases.CONTROLLED}
    for company in db.query(Company).filter(Company.page_overrides.isnot(None)):
        for section, value in releases.clean_overrides(company.page_overrides).items():
            overrides[section][value].append({"id": str(company.id), "name": company.name})
    return {
        "stages": list(releases.STAGES),
        "always_on": sorted(releases.ALWAYS_ON),
        "pages": [
            {
                "section": s,
                "stage": stages[s],
                "code_stage": releases.CODE_STAGES.get(s, "everyone"),
                "turned_on_for": overrides[s]["on"],
                "turned_off_for": overrides[s]["off"],
            }
            for s in releases.CONTROLLED
        ],
    }


@router.get("/pages")
def pages(db: Session = Depends(get_db)):
    return _pages_payload(db)


@router.put("/pages/{section}")
def set_stage(section: str, body: StageUpdate, db: Session = Depends(get_db), admin=Depends(require_platform_admin)):
    if section not in releases.CONTROLLED:
        raise NotFoundError("Page not found")
    if body.stage not in releases.STAGES:
        raise BadRequestError("Pick a release stage.")
    row = db.get(PageRelease, section)
    if row is None:
        db.add(PageRelease(section=section, stage=body.stage, updated_by=admin.id))
    else:
        row.stage = body.stage
        row.updated_by = admin.id
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    releases.forget_cached()
    return _pages_payload(db)


@router.put("/tenants/{tenant_id}/pages")
def set_tenant_page(tenant_id: uuid.UUID, body: TenantPageUpdate, db: Session = Depends(get_db)):
    company = db.get(Company, tenant_id)
    if company is None:
        raise NotFoundError("Tenant not found")
    if body.section not in releases.CONTROLLED:
        raise BadRequestError("That page is always on.")
    current = releases.clean_overrides(company.page_overrides)
    if body.value == "default":
        current.pop(body.section, None)
    elif body.value in releases.OVERRIDES:
        current[body.section] = body.value
    else:
        raise BadRequestError("Pick on, off or default.")
    company.page_overrides = current or None
    db.commit()
    return {"page_overrides": company.page_overrides or {}, "sections": list(ALL_SECTIONS)}


# ── vouchers ─────────────────────────────────────────────────────────────────


class VoucherCreate(BaseModel):
    code: str | None = Field(None, max_length=40)
    kind: str
    plan_id: uuid.UUID | None = None
    billing_interval: str | None = None
    percent_off: Decimal | None = None
    amount_off: Decimal | None = None
    amount_off_usd: Decimal | None = None
    free_months: int = 0
    free_days: int = 0
    company_id: uuid.UUID | None = None
    max_uses: int | None = Field(None, ge=1, le=100000)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    note: str | None = Field(None, max_length=300)


class VoucherUpdate(BaseModel):
    is_active: bool | None = None
    expires_at: datetime | None = None
    clear_expiry: bool = False
    note: str | None = Field(None, max_length=300)
    max_uses: int | None = Field(None, ge=1, le=100000)


def _voucher(db: Session, voucher_id: uuid.UUID) -> Voucher:
    v = (
        db.query(Voucher)
        .options(joinedload(Voucher.plan), joinedload(Voucher.company))
        .filter(Voucher.id == voucher_id)
        .first()
    )
    if v is None:
        raise NotFoundError("Voucher not found")
    return v


@router.get("/vouchers")
def list_vouchers(db: Session = Depends(get_db)):
    used = dict(
        db.query(VoucherRedemption.voucher_id, func.count(VoucherRedemption.id))
        .group_by(VoucherRedemption.voucher_id)
        .all()
    )
    rows = (
        db.query(Voucher)
        .options(joinedload(Voucher.plan), joinedload(Voucher.company))
        .order_by(Voucher.created_at.desc())
        .all()
    )
    return [vouchers.serialize_admin(db, v, used.get(v.id, 0)) for v in rows]


@router.get("/vouchers/{voucher_id}/uses")
def voucher_uses(voucher_id: uuid.UUID, db: Session = Depends(get_db)):
    _voucher(db, voucher_id)
    rows = (
        db.query(VoucherRedemption)
        .filter(VoucherRedemption.voucher_id == voucher_id)
        .order_by(VoucherRedemption.created_at.desc())
        .all()
    )
    return [
        {
            "company_id": str(r.company_id) if r.company_id else None,
            "company_name": r.company_name,
            "currency": r.currency,
            "discount": float(r.discount or 0),
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/vouchers", status_code=status.HTTP_201_CREATED)
def create_voucher(body: VoucherCreate, db: Session = Depends(get_db), admin=Depends(require_platform_admin)):
    fields = vouchers.validate_new(body.model_dump())
    if fields["plan_id"] is not None:
        plan = db.get(SubscriptionPlan, fields["plan_id"])
        if plan is None:
            raise BadRequestError("That plan doesn't exist.")
        if plan.code == "free":
            raise BadRequestError("A voucher can't be for the Free plan.")
    if body.company_id is not None and db.get(Company, body.company_id) is None:
        raise BadRequestError("That account doesn't exist.")
    if body.expires_at and body.starts_at and body.expires_at <= body.starts_at:
        raise BadRequestError("The voucher must end after it starts.")
    if body.expires_at and body.expires_at <= datetime.now(timezone.utc):
        raise BadRequestError("The end date has already passed.")
    code = vouchers.normalize(body.code) if body.code else vouchers.generate_code(db)
    if not vouchers._CODE_RE.match(code):
        raise BadRequestError("A code is 4 to 40 letters and numbers.")
    if len(code) < 8:
        raise BadRequestError("Make the code at least 8 letters and numbers, so it can't be guessed.")
    if db.query(Voucher.id).filter(Voucher.code == code).first():
        raise ConflictError("There's already a voucher with that code.")
    voucher = Voucher(
        code=code,
        company_id=body.company_id,
        # Locked to one account: one use. Otherwise as many as BossAdmin says.
        max_uses=1 if body.company_id is not None else body.max_uses,
        starts_at=body.starts_at,
        expires_at=body.expires_at,
        note=(body.note or "").strip() or None,
        created_by=admin.id,
        **fields,
    )
    db.add(voucher)
    db.commit()
    return vouchers.serialize_admin(db, _voucher(db, voucher.id), 0)


@router.patch("/vouchers/{voucher_id}")
def update_voucher(voucher_id: uuid.UUID, body: VoucherUpdate, db: Session = Depends(get_db)):
    voucher = _voucher(db, voucher_id)
    if body.is_active is not None:
        voucher.is_active = body.is_active
    if body.clear_expiry:
        voucher.expires_at = None
    elif body.expires_at is not None:
        voucher.expires_at = body.expires_at
    if body.note is not None:
        voucher.note = body.note.strip() or None
    if body.max_uses is not None and voucher.company_id is None:
        voucher.max_uses = body.max_uses
    db.commit()
    return vouchers.serialize_admin(db, _voucher(db, voucher_id))


@router.delete("/vouchers/{voucher_id}")
def delete_voucher(voucher_id: uuid.UUID, db: Session = Depends(get_db)):
    voucher = _voucher(db, voucher_id)
    from ..models.plan_payment import PlanPayment
    from ..models.upgrade_request import UpgradeRequest

    in_use = (
        vouchers.uses(db, voucher.id)
        or db.query(PlanPayment.id).filter(PlanPayment.voucher_id == voucher.id).first()
        or db.query(UpgradeRequest.id).filter(UpgradeRequest.voucher_id == voucher.id).first()
    )
    if in_use:
        raise ConflictError("This voucher has been used. Turn it off instead, so its record stays.")
    db.delete(voucher)
    db.commit()
    return {"message": "Voucher deleted"}


@router.get("/tenant-names")
def tenant_names(db: Session = Depends(get_db)):
    """Every mill's id and name, for the voucher's account picker."""
    return [{"id": str(c.id), "name": c.name} for c in db.query(Company).order_by(Company.name).all()]
