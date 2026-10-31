"""Stock count HTTP controller (Enterprise, with the automations): the stock on
the floor against the records.

Anyone with inventory access sees the counts; counting needs inventory write
access. The sheet shows no recorded quantities, so the count isn't nudged
towards them. Reviewing a count is for owners and admins.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..automations import actions, stock_count
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..core.timezones import tenant_zone
from ..models.company import Branch
from ..models.stock_count import StockCount
from ..models.user import User

router = APIRouter(dependencies=[Depends(require_feature("automations")), Depends(require_section_access("inventory"))])
write = [Depends(require_section_access("inventory", write=True))]


class LineIn(BaseModel):
    kind: Literal["milled_rice", "palay", "byproduct"]
    inventory_id: uuid.UUID
    counted_kg: Decimal = Field(ge=0, le=100_000_000, max_digits=12, decimal_places=3)


class CountIn(BaseModel):
    lines: list[LineIn] = Field(min_length=1, max_length=500)
    note: str = Field("", max_length=500)
    branch_id: uuid.UUID | None = None


class Choice(BaseModel):
    """How one line or kind of stock is counted; what's left out follows the default."""

    unit: Literal["sacks", "kg"] | None = None
    sack_kg: float | None = Field(None, gt=0, le=1000)


class ChoicesIn(BaseModel):
    defaults: dict[Literal["milled_rice", "palay", "byproduct"], Choice] = {}
    lines: dict[uuid.UUID, Choice] = Field(default_factory=dict, max_length=5000)


class ReviewIn(BaseModel):
    note: str = Field(..., min_length=1, max_length=500)


def _today(user) -> date:
    return datetime.now(tenant_zone(user.company.timezone)).date()


def _out(count: StockCount, tolerance: float, users: dict[uuid.UUID, User], branches: dict[uuid.UUID, str]) -> dict:
    counter = users.get(count.counted_by) if count.counted_by else None
    reviewer = users.get(count.reviewed_by) if count.reviewed_by else None
    return {
        "id": str(count.id),
        "date": count.count_date.isoformat(),
        "branch": branches.get(count.branch_id) if count.branch_id else None,
        "note": count.note,
        "counted_by": actions.name(counter) if counter else None,
        "needs_review": stock_count.needs_review(count, tolerance),
        "reviewed_by": actions.name(reviewer) if reviewer else None,
        "review_note": count.review_note,
        "lines": [
            {
                "label": line.label,
                "recorded_kg": float(line.recorded_kg),
                "counted_kg": float(line.counted_kg),
                "difference_kg": float(line.difference_kg),
                "out": stock_count.out_of_line(line, tolerance),
            }
            for line in count.lines
        ],
    }


def _users(db: Session, company_id) -> dict[uuid.UUID, User]:
    return {u.id: u for u in db.query(User).filter(User.company_id == company_id)}


def _branches(db: Session, company_id) -> dict[uuid.UUID, str]:
    return {b.id: b.name for b in db.query(Branch).filter(Branch.company_id == company_id)}


@router.get("/")
def counts_and_sheet(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    _, params = stock_count.params_for(db)
    counts = db.query(StockCount).order_by(StockCount.count_date.desc(), StockCount.created_at.desc()).limit(12).all()
    users = _users(db, current_user.company_id)
    branches = _branches(db, current_user.company_id)
    return {
        # No recorded quantities: a blind count.
        "sheet": [
            {
                "kind": line.kind,
                "inventory_id": str(line.inventory_id),
                "label": line.label,
                "item": line.item,
                "branch": line.branch,
                "branch_id": str(line.branch_id) if line.branch_id else None,
            }
            for line in stock_count.sheet(db, current_user.company_id)
        ],
        "tolerance_pct": params.tolerance_pct,
        "manager": actions.is_manager(current_user),
        "choices": current_user.company.stock_count_settings or {"defaults": {}, "lines": {}},
        "counts": [_out(c, params.tolerance_pct, users, branches) for c in counts],
    }


@router.put("/choices", dependencies=write)
def save_choices(body: ChoicesIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    choices = body.model_dump(mode="json", exclude_none=True)
    current_user.company.stock_count_settings = choices
    db.commit()
    return choices


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=write)
def record_count(body: CountIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    lines = stock_count.sheet(db, current_user.company_id)
    on_sheet = {(line.kind, line.inventory_id) for line in lines}
    counted: dict[tuple[str, uuid.UUID], Decimal] = {
        (line.kind, line.inventory_id): line.counted_kg for line in body.lines
    }
    if not set(counted) <= on_sheet:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Some lines aren't on the stock sheet.")
    if body.branch_id is not None and any(
        line.branch_id != body.branch_id for line in lines if (line.kind, line.inventory_id) in counted
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Some lines aren't in the branch being counted."
        )
    count = stock_count.save(
        db,
        current_user.company,
        current_user,
        day=_today(current_user),
        counted=counted,
        note=body.note.strip() or None,
        branch_id=body.branch_id,
    )
    db.commit()
    db.refresh(count)
    _, params = stock_count.params_for(db)
    company_id = current_user.company_id
    return _out(count, params.tolerance_pct, _users(db, company_id), _branches(db, company_id))


@router.post("/{count_id}/review")
def review(count_id: uuid.UUID, body: ReviewIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not actions.is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an owner or admin can review a count.")
    count = db.get(StockCount, count_id)
    if count is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such count")
    count.reviewed_at = datetime.now(timezone.utc)
    count.reviewed_by = current_user.id
    count.review_note = body.note.strip()
    db.commit()
    _, params = stock_count.params_for(db)
    company_id = current_user.company_id
    return _out(count, params.tolerance_pct, _users(db, company_id), _branches(db, company_id))
