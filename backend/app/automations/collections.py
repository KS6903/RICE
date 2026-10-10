"""The collections list: who to chase first, what they owe, a reminder ready to
send, and what happened last time.

One workflow in place of three separate alerts: the morning list of invoices
due, the weekly call list and the reminder drafts all point here. Customers are
ranked by what is overdue, with a promise that wasn't kept by its date first
and a promise still in the future after the rest (they said when; wait).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.collections import CollectionFollowUp
from ..models.sales import Invoice, Payment
from ..models.supplier_customer import Customer
from ..models.user import User
from . import credit
from .format import peso, plural

OUTCOMES = {
    "called": "Called",
    "no_answer": "No answer",
    "reminder_sent": "Reminder sent",
    "promised": "Promised to pay",
    "paid": "Paid",
    "disputed": "Disputes the bill",
}


@dataclass
class Debtor:
    customer: Customer
    overdue: Decimal = Decimal(0)
    due_soon: Decimal = Decimal(0)
    oldest_days_late: int = 0
    invoices: list[Invoice] = field(default_factory=list)
    last_paid: date | None = None
    last: CollectionFollowUp | None = None

    @property
    def total(self) -> Decimal:
        return self.overdue + self.due_soon

    def promise_state(self, today: date) -> str | None:
        """'broken' when they promised to pay by a date now past and still owe
        overdue money; 'waiting' when the promised date is still ahead."""
        if self.last is None or self.last.outcome != "promised" or self.last.promised_date is None:
            return None
        if self.last.promised_date < today:
            return "broken" if self.overdue > 0 else None
        return "waiting"


def _due(inv: Invoice) -> date:
    return inv.due_date or inv.invoice_date


def worklist(db: Session, today: date, *, due_within_days: int = 7) -> list[Debtor]:
    """Customers with money overdue, or due within ``due_within_days``, in the
    order to chase them."""
    invoices = (
        db.query(Invoice)
        .filter(Invoice.status.in_(credit.OPEN_INVOICE), Invoice.customer_id.isnot(None))
        .order_by(func.coalesce(Invoice.due_date, Invoice.invoice_date))
        .all()
    )
    debtors: dict[uuid.UUID, Debtor] = {}
    for inv in invoices:
        balance = Decimal(inv.total_amount - inv.paid_amount)
        due = _due(inv)
        if balance <= 0 or inv.customer is None or (due - today).days > due_within_days:
            continue
        d = debtors.setdefault(inv.customer.id, Debtor(customer=inv.customer))
        d.invoices.append(inv)
        if due < today:
            d.overdue += balance
            d.oldest_days_late = max(d.oldest_days_late, (today - due).days)
        else:
            d.due_soon += balance
    if not debtors:
        return []
    ids = list(debtors)
    for customer_id, paid_on in (
        db.query(Invoice.customer_id, func.max(Payment.payment_date))
        .join(Payment, Payment.invoice_id == Invoice.id)
        .filter(Invoice.customer_id.in_(ids))
        .group_by(Invoice.customer_id)
    ):
        if customer_id in debtors:
            debtors[customer_id].last_paid = paid_on
    latest = (
        db.query(CollectionFollowUp.customer_id, func.max(CollectionFollowUp.created_at).label("at"))
        .filter(CollectionFollowUp.customer_id.in_(ids))
        .group_by(CollectionFollowUp.customer_id)
        .subquery()
    )
    for follow_up in db.query(CollectionFollowUp).join(
        latest,
        (CollectionFollowUp.customer_id == latest.c.customer_id) & (CollectionFollowUp.created_at == latest.c.at),
    ):
        debtors[follow_up.customer_id].last = follow_up

    def rank(d: Debtor) -> tuple:
        state = d.promise_state(today)
        group = 0 if state == "broken" else 2 if state == "waiting" else 1
        return (group, -d.overdue, -d.due_soon, d.customer.name)

    return sorted(debtors.values(), key=rank)


def reminder(debtor: Debtor, mill: str, today: date) -> str:
    """A plain text message to send by SMS or Messenger. Polite first, firmer
    once a promise has been missed or the debt is old; the mill reads it before
    it goes."""
    name = debtor.customer.contact_person or debtor.customer.name
    overdue = [i for i in debtor.invoices if _due(i) < today]
    if not overdue:
        soon = debtor.invoices[0]
        when = "today" if _due(soon) == today else f"on {_due(soon):%A %d %B}"
        return (
            f"Good day {name}! A friendly reminder from {mill}: invoice {soon.invoice_no} "
            f"for {peso(soon.total_amount - soon.paid_amount)} is due {when}. Thank you for your business!"
        )
    what = f"invoice {overdue[0].invoice_no}" if len(overdue) == 1 else f"{plural(len(overdue), 'invoice')}"
    if debtor.promise_state(today) == "broken":
        assert debtor.last is not None and debtor.last.promised_date is not None
        return (
            f"Good day {name}. This is {mill}. We were expecting your payment on "
            f"{debtor.last.promised_date:%A %d %B}. {peso(debtor.overdue)} is still overdue on {what}. "
            "Please settle it, or tell us the date you can pay. Thank you."
        )
    if debtor.oldest_days_late > 30:
        return (
            f"Good day {name}. This is {mill}. {peso(debtor.overdue)} on {what} is now over a month overdue. "
            "Please settle it this week, or call us so we can agree a date. Thank you."
        )
    return (
        f"Good day {name}! This is {mill}. A gentle reminder that {peso(debtor.overdue)} on {what} is "
        "now due. Please let us know when you can pay. Thank you!"
    )


def describe(follow_up: CollectionFollowUp, users: dict[uuid.UUID, User]) -> str:
    text = OUTCOMES.get(follow_up.outcome, follow_up.outcome)
    if follow_up.outcome == "promised":
        amount = f" {peso(follow_up.promised_amount)}" if follow_up.promised_amount else ""
        when = f" by {follow_up.promised_date:%a %d %b}" if follow_up.promised_date else ""
        text += f"{amount}{when}"
    who = users.get(follow_up.created_by) if follow_up.created_by else None
    if who:
        text += f" ({who.full_name or who.username})"
    return text
