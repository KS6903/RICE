"""Vouchers: codes BossAdmin makes and gives out (api/admin_security.py), and a
mill uses in Billing (api/billing.py).

What one gives is BossAdmin's choice, voucher by voucher:

- free time: a plan for so many months and days, no payment. Redeemed in
  Billing; the plan is on at once.
- percent off, or an amount off (pesos, and dollars if set): taken off one
  payment for a plan, online or by bank transfer, when the code is typed at
  checkout.

And who and when: locked to one mill (it works there only, so it can't be
passed on or sold), for one plan, monthly or annual only, from and until a date,
and for how many mills in all. Each mill uses a voucher once: the database
holds that (uq_voucher_redemptions_once), not just this code.

Everything is worked out here, on the server, from the voucher's own row: the
price a mill is asked for comes from the plan and the voucher, never from the
browser. The row is locked while it is checked and used, so two mills can't
take the last use at once.
"""

from __future__ import annotations

import calendar
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError
from ..models.subscription import Subscription, SubscriptionPlan
from ..models.upgrade_request import UpgradeRequest
from ..models.voucher import AMOUNT_OFF, FREE_TIME, KINDS, PERCENT_OFF, Voucher, VoucherRedemption

# No 0/O, 1/I/L: a code read out over the phone comes out right.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_RE = re.compile(r"^[A-Z0-9]{4,40}$")
CENT = Decimal("0.01")


def normalize(code: str | None) -> str:
    """Upper case, without the spaces and dashes people type or copy."""
    return re.sub(r"[\s-]+", "", code or "").upper()


def generate_code(db: Session, length: int = 12) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(length))
        if not db.query(Voucher.id).filter(Voucher.code == code).first():
            return code
    raise BadRequestError("Couldn't make a new code. Try again.")


def pretty(code: str) -> str:
    """ABCD-EFGH-JKMN: easier to read and type."""
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def uses(db: Session, voucher_id: uuid.UUID) -> int:
    return db.query(func.count(VoucherRedemption.id)).filter(VoucherRedemption.voucher_id == voucher_id).scalar() or 0


def _add_months(start: datetime, months: int) -> datetime:
    month = start.month - 1 + months
    year, month = start.year + month // 12, month % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


def find_usable(db: Session, code: str | None, company_id: uuid.UUID, *, lock: bool = False) -> Voucher:
    """The voucher this mill may use now, or a refusal saying why."""
    wanted = normalize(code)
    if not _CODE_RE.match(wanted):
        raise BadRequestError("That voucher code isn't valid.", code="voucher_invalid")
    query = db.query(Voucher).filter(Voucher.code == wanted)
    if lock:
        query = query.with_for_update()
    voucher = query.first()
    if voucher is None or not voucher.is_active:
        raise BadRequestError("That voucher code isn't valid.", code="voucher_invalid")
    if voucher.company_id is not None and voucher.company_id != company_id:
        # Locked to another account: it can't be passed on.
        raise BadRequestError(
            "This voucher belongs to another account and can't be used here.", code="voucher_not_yours"
        )
    now = datetime.now(timezone.utc)
    if voucher.starts_at and voucher.starts_at > now:
        raise BadRequestError("This voucher can't be used yet.", code="voucher_not_started")
    if voucher.expires_at and voucher.expires_at <= now:
        raise BadRequestError("This voucher has expired.", code="voucher_expired")
    used_here = (
        db.query(VoucherRedemption.id)
        .filter(VoucherRedemption.voucher_id == voucher.id, VoucherRedemption.company_id == company_id)
        .first()
    )
    if used_here:
        raise BadRequestError("Your account has already used this voucher.", code="voucher_used")
    if voucher.max_uses is not None and uses(db, voucher.id) >= voucher.max_uses:
        raise BadRequestError("This voucher has been used up.", code="voucher_used_up")
    return voucher


def check_for_payment(voucher: Voucher, plan: SubscriptionPlan, interval: str) -> None:
    if voucher.kind == FREE_TIME:
        raise BadRequestError(
            "This voucher gives free time on a plan. Redeem it in Billing instead.", code="voucher_free_time"
        )
    if voucher.plan_id is not None and voucher.plan_id != plan.id:
        name = voucher.plan.name if voucher.plan else "another"
        raise BadRequestError(f"This voucher is for the {name} plan.", code="voucher_wrong_plan")
    if voucher.billing_interval and voucher.billing_interval != interval:
        which = "yearly" if voucher.billing_interval == "annual" else "monthly"
        raise BadRequestError(f"This voucher is for {which} payments only.", code="voucher_wrong_interval")


def discount_for(voucher: Voucher, price: Decimal, currency: str) -> Decimal:
    """What the voucher takes off ``price``: never more than the price."""
    price = Decimal(price)
    if voucher.kind == PERCENT_OFF:
        off = (price * Decimal(voucher.percent_off or 0) / Decimal(100)).quantize(CENT, rounding=ROUND_HALF_UP)
    elif voucher.kind == AMOUNT_OFF:
        amount = voucher.amount_off_usd if currency == "USD" else voucher.amount_off
        if not amount:
            raise BadRequestError(
                "This voucher can't be used for payments in US dollars. Pay in pesos instead.",
                code="voucher_no_usd",
            )
        off = Decimal(amount)
    else:
        off = Decimal(0)
    return max(Decimal(0), min(off, price)).quantize(CENT)


def apply_to_payment(
    db: Session,
    code: str | None,
    company_id: uuid.UUID,
    plan: SubscriptionPlan,
    interval: str,
    price: Decimal,
    currency: str,
) -> tuple[Voucher | None, Decimal]:
    """(voucher, discount) for a payment, or (None, 0) with no code."""
    if not normalize(code):
        return None, Decimal(0)
    voucher = find_usable(db, code, company_id, lock=True)
    check_for_payment(voucher, plan, interval)
    return voucher, discount_for(voucher, price, currency)


def record_use(
    db: Session,
    voucher_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    company_name: str,
    user_id: uuid.UUID | None,
    plan_id: uuid.UUID | None,
    currency: str | None,
    discount: Decimal,
    plan_payment_id: uuid.UUID | None = None,
    upgrade_request_id: uuid.UUID | None = None,
) -> bool:
    """Write the mill's use of the voucher. False when it was already used
    there (the unique constraint): the money for it is already in, so the
    payment or request still goes through. Flushes only."""
    try:
        with db.begin_nested():
            db.add(
                VoucherRedemption(
                    voucher_id=voucher_id,
                    company_id=company_id,
                    company_name=company_name or "",
                    user_id=user_id,
                    plan_id=plan_id,
                    currency=currency,
                    discount=discount,
                    plan_payment_id=plan_payment_id,
                    upgrade_request_id=upgrade_request_id,
                )
            )
    except IntegrityError:
        return False
    return True


def redeem_free_time(db: Session, user, code: str | None) -> dict:
    """Turn the voucher's plan on for its free time. Same plan as now: the
    time is added to what's left. Another plan: it starts today."""
    from ..core.security import invalidate_company_features
    from .subscription import activate_subscription, resolve_pending_upgrade_requests

    company_id = user.company_id
    voucher = find_usable(db, code, company_id, lock=True)
    if voucher.kind != FREE_TIME:
        raise BadRequestError(
            "This voucher takes money off a payment. Type it at checkout instead.", code="voucher_discount"
        )
    plan = db.get(SubscriptionPlan, voucher.plan_id) if voucher.plan_id else None
    if plan is None or not plan.is_active:
        raise BadRequestError("The plan on this voucher isn't offered any more.", code="voucher_invalid")
    now = datetime.now(timezone.utc)
    sub = db.query(Subscription).filter(Subscription.company_id == company_id).with_for_update().first()
    start = now
    if sub is not None and sub.plan_id == plan.id:
        if sub.expires_at is None and sub.status in ("active", "trial"):
            raise BadRequestError(
                f"Your {plan.name} plan has no end date, so there's no time to add.", code="voucher_no_end"
            )
        if sub.expires_at and sub.expires_at > now:
            start = sub.expires_at
    expires_at = _add_months(start, voucher.free_months) + timedelta(days=voucher.free_days)
    company = user.company
    record = UpgradeRequest(
        company_id=company_id,
        requested_plan_id=plan.id,
        current_plan_id=sub.plan_id if sub else None,
        requested_by=user.id,
        request_type="upgrade",
        billing_interval="monthly",
        status="approved",
        note=f"Voucher {pretty(voucher.code)}: free time",
        admin_note="Voucher",
        resolved_at=now,
        voucher_id=voucher.id,
    )
    db.add(record)
    db.flush()
    if not record_use(
        db,
        voucher.id,
        company_id=company_id,
        company_name=company.name if company else "",
        user_id=user.id,
        plan_id=plan.id,
        currency=None,
        discount=Decimal(0),
        upgrade_request_id=record.id,
    ):
        db.rollback()
        raise BadRequestError("Your account has already used this voucher.", code="voucher_used")
    activate_subscription(
        db,
        company_id=company_id,
        plan_id=plan.id,
        expires_at=expires_at,
        notes=f"Voucher {pretty(voucher.code)}",
    )
    resolve_pending_upgrade_requests(db, company_id, plan.id, auto_note="Resolved by a voucher for the plan.")
    db.commit()
    invalidate_company_features(company_id)
    return {"plan_name": plan.name, "expires_at": expires_at.isoformat()}


def describe(voucher: Voucher) -> dict:
    """What the mill is told about a voucher it may use."""
    return {
        "code": pretty(voucher.code),
        "kind": voucher.kind,
        "plan_id": str(voucher.plan_id) if voucher.plan_id else None,
        "plan_name": voucher.plan.name if voucher.plan else None,
        "billing_interval": voucher.billing_interval,
        "percent_off": float(voucher.percent_off) if voucher.percent_off is not None else None,
        "amount_off": float(voucher.amount_off) if voucher.amount_off is not None else None,
        "amount_off_usd": float(voucher.amount_off_usd) if voucher.amount_off_usd is not None else None,
        "free_months": voucher.free_months,
        "free_days": voucher.free_days,
        "expires_at": voucher.expires_at.isoformat() if voucher.expires_at else None,
    }


def serialize_admin(db: Session, voucher: Voucher, used: int | None = None) -> dict:
    """What BossAdmin sees about a voucher."""
    return {
        **describe(voucher),
        "id": str(voucher.id),
        "raw_code": voucher.code,
        "company_id": str(voucher.company_id) if voucher.company_id else None,
        "company_name": voucher.company.name if voucher.company else None,
        "max_uses": voucher.max_uses,
        "uses": uses(db, voucher.id) if used is None else used,
        "starts_at": voucher.starts_at.isoformat() if voucher.starts_at else None,
        "is_active": voucher.is_active,
        "note": voucher.note,
        "created_at": voucher.created_at.isoformat() if voucher.created_at else None,
    }


def validate_new(data: dict) -> dict:
    """Check what BossAdmin typed for a new voucher, and tidy it."""
    kind = data.get("kind")
    if kind not in KINDS:
        raise BadRequestError("Pick what the voucher gives.")
    out = {
        "kind": kind,
        "plan_id": data.get("plan_id"),
        "billing_interval": data.get("billing_interval")
        if data.get("billing_interval") in ("monthly", "annual")
        else None,
        "percent_off": None,
        "amount_off": None,
        "amount_off_usd": None,
        "free_months": 0,
        "free_days": 0,
    }
    if kind == FREE_TIME:
        months, days = int(data.get("free_months") or 0), int(data.get("free_days") or 0)
        if months < 0 or days < 0 or (months == 0 and days == 0):
            raise BadRequestError("Say how much free time the voucher gives.")
        if months > 36 or days > 366:
            raise BadRequestError("Free time can be at most 36 months and 366 days.")
        if not out["plan_id"]:
            raise BadRequestError("Pick the plan the free time is on.")
        out.update(free_months=months, free_days=days, billing_interval=None)
    elif kind == PERCENT_OFF:
        pct = Decimal(str(data.get("percent_off") or 0))
        if not (Decimal(0) < pct <= Decimal(100)):
            raise BadRequestError("The percent off must be more than 0 and at most 100.")
        out["percent_off"] = pct.quantize(CENT)
    else:
        php = Decimal(str(data.get("amount_off") or 0))
        usd = Decimal(str(data.get("amount_off_usd") or 0))
        if php <= 0 and usd <= 0:
            raise BadRequestError("Say how much the voucher takes off.")
        out["amount_off"] = php.quantize(CENT) if php > 0 else None
        out["amount_off_usd"] = usd.quantize(CENT) if usd > 0 else None
    return out
