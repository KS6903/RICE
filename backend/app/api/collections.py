"""Collections HTTP controller (Pro and up, `collections` feature): who to chase
for money first, what they owe, a reminder to send, and what happened. The
scheduled reminders are an automation, which stays Enterprise.

Anyone with access to sales sees the list; recording what happened needs
sales write access.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from ..automations import collections
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..core.timezones import tenant_zone
from ..models.collections import CollectionFollowUp
from ..models.supplier_customer import Customer
from ..models.user import User

router = APIRouter(dependencies=[Depends(require_feature("collections")), Depends(require_section_access("sales"))])


class FollowUpIn(BaseModel):
    outcome: Literal["called", "no_answer", "reminder_sent", "promised", "paid", "disputed"]
    promised_date: date | None = None
    promised_amount: Decimal | None = Field(None, gt=0, max_digits=14, decimal_places=2)
    note: str = Field("", max_length=500)

    @model_validator(mode="after")
    def _promise_has_a_date(self) -> "FollowUpIn":
        if self.outcome == "promised" and self.promised_date is None:
            raise ValueError("Say when they promised to pay.")
        return self


def _today(user) -> date:
    return datetime.now(tenant_zone(user.company.timezone)).date()


def _users(db: Session, company_id) -> dict[uuid.UUID, User]:
    return {u.id: u for u in db.query(User).filter(User.company_id == company_id)}


def _debtor_out(d: collections.Debtor, today: date, mill: str, users: dict) -> dict:
    return {
        "customer": {"id": str(d.customer.id), "name": d.customer.name, "phone": d.customer.phone},
        "overdue": float(d.overdue),
        "due_soon": float(d.due_soon),
        "oldest_days_late": d.oldest_days_late,
        "last_paid": d.last_paid.isoformat() if d.last_paid else None,
        "promise": d.promise_state(today),
        "last_follow_up": collections.describe(d.last, users) if d.last else None,
        "last_follow_up_at": d.last.created_at.isoformat() if d.last else None,
        "invoices": [
            {
                "invoice_no": i.invoice_no,
                "balance": float(i.total_amount - i.paid_amount),
                "due": (i.due_date or i.invoice_date).isoformat(),
                "days_late": max(0, (today - (i.due_date or i.invoice_date)).days),
            }
            for i in d.invoices
        ],
        "reminder": collections.reminder(d, mill, today),
    }


@router.get("/")
def worklist(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    today = _today(current_user)
    debtors = collections.worklist(db, today)
    users = _users(db, current_user.company_id)
    mill = current_user.company.name
    return {
        "today": today.isoformat(),
        "overdue_total": float(sum((d.overdue for d in debtors), Decimal(0))),
        "customers": [_debtor_out(d, today, mill, users) for d in debtors],
    }


@router.get("/{customer_id}/follow-ups")
def history(customer_id: uuid.UUID, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    users = _users(db, current_user.company_id)
    rows = (
        db.query(CollectionFollowUp)
        .filter(CollectionFollowUp.customer_id == customer_id)
        .order_by(CollectionFollowUp.created_at.desc())
        .limit(30)
        .all()
    )
    return {
        "follow_ups": [
            {
                "id": str(f.id),
                "outcome": f.outcome,
                "summary": collections.describe(f, users),
                "note": f.note,
                "created_at": f.created_at.isoformat(),
            }
            for f in rows
        ]
    }


@router.post(
    "/{customer_id}/follow-ups",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("sales", write=True))],
)
def record(
    customer_id: uuid.UUID, body: FollowUpIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    customer = db.get(Customer, customer_id)
    if customer is None or customer.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such customer")
    follow_up = CollectionFollowUp(
        company_id=current_user.company_id,
        customer_id=customer.id,
        outcome=body.outcome,
        promised_date=body.promised_date if body.outcome == "promised" else None,
        promised_amount=body.promised_amount if body.outcome == "promised" else None,
        note=body.note.strip() or None,
        created_by=current_user.id,
    )
    db.add(follow_up)
    db.commit()
    return {"id": str(follow_up.id), "summary": collections.describe(follow_up, {current_user.id: current_user})}
