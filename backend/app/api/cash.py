"""Cash count HTTP controller (Pro and up, `cash_count` feature): the drawer
counted at close, against what it should hold. The alert to the owner when a
count is out comes from the cash-count automation, which stays Enterprise.

Anyone with sales access sees the counts; counting needs sales write access
(cashiers, owners, admins, accountants). Reviewing a difference is for owners
and admins.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..automations import actions, cash
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..core.timezones import tenant_zone
from ..models.cash import CashCount
from ..models.user import User

router = APIRouter(dependencies=[Depends(require_feature("cash_count")), Depends(require_section_access("sales"))])
write = [Depends(require_section_access("sales", write=True))]

Money = Field(ge=0, le=100_000_000, max_digits=14, decimal_places=2)


class CountIn(BaseModel):
    counted: Decimal = Money
    cash_out: Decimal = Field(Decimal(0), ge=0, le=100_000_000, max_digits=14, decimal_places=2)
    taken_out: Decimal = Field(Decimal(0), ge=0, le=100_000_000, max_digits=14, decimal_places=2)
    # Leave out to carry over from the last count.
    opening: Decimal | None = Field(None, ge=0, le=100_000_000, max_digits=14, decimal_places=2)
    note: str = Field("", max_length=500)


class ReviewIn(BaseModel):
    note: str = Field(..., min_length=1, max_length=500)


def _today(user) -> date:
    return datetime.now(tenant_zone(user.company.timezone)).date()


def _out(count: CashCount, tolerance: Decimal, users: dict[uuid.UUID, User]) -> dict:
    counter = users.get(count.counted_by) if count.counted_by else None
    reviewer = users.get(count.reviewed_by) if count.reviewed_by else None
    return {
        "id": str(count.id),
        "date": count.count_date.isoformat(),
        "opening": float(count.opening),
        "cash_in": float(count.cash_in),
        "cash_out": float(count.cash_out),
        "expected": float(count.expected),
        "counted": float(count.counted),
        "taken_out": float(count.taken_out),
        "difference": float(count.difference),
        "note": count.note,
        "counted_by": actions.name(counter) if counter else None,
        "needs_review": cash.needs_review(count, tolerance),
        "reviewed_by": actions.name(reviewer) if reviewer else None,
        "reviewed_at": count.reviewed_at.isoformat() if count.reviewed_at else None,
        "review_note": count.review_note,
    }


def _users(db: Session, company_id) -> dict[uuid.UUID, User]:
    return {u.id: u for u in db.query(User).filter(User.company_id == company_id)}


@router.get("/")
def today_and_history(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    today = _today(current_user)
    _, params = cash.params_for(db)
    tolerance = Decimal(params.tolerance)
    users = _users(db, current_user.company_id)
    received = cash.cash_received(db, today)
    counts = cash.last_counts(db)
    return {
        "today": {
            "date": today.isoformat(),
            "opening": float(cash.opening_for(db, today)),
            "cash_received": [{"who": who, "amount": float(amount)} for who, amount in received],
            "cash_in": float(sum((amount for _, amount in received), Decimal(0))),
            "expenses_entered": float(cash.expenses_on(db, today)),
        },
        "tolerance": float(tolerance),
        "manager": actions.is_manager(current_user),
        "counts": [_out(c, tolerance, users) for c in counts],
    }


@router.post("/", dependencies=write)
def count_today(body: CountIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Record today's count, or correct it. A corrected count needs a fresh review."""
    count = cash.save(
        db,
        current_user.company,
        current_user,
        day=_today(current_user),
        counted=body.counted,
        cash_out=body.cash_out,
        taken_out=body.taken_out,
        opening=body.opening,
        note=body.note.strip() or None,
    )
    db.commit()
    _, params = cash.params_for(db)
    return _out(count, Decimal(params.tolerance), _users(db, current_user.company_id))


@router.post("/{count_id}/review")
def review(count_id: uuid.UUID, body: ReviewIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not actions.is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an owner or admin can review a count.")
    count = db.get(CashCount, count_id)
    if count is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such count")
    count.reviewed_at = datetime.now(timezone.utc)
    count.reviewed_by = current_user.id
    count.review_note = body.note.strip()
    db.commit()
    _, params = cash.params_for(db)
    return _out(count, Decimal(params.tolerance), _users(db, current_user.company_id))
