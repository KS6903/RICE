"""Credit-limit guard: what a customer owes, checked when an order is taken.

A customer with a credit limit above zero may not owe more than that. When
the credit_guard recipe is switched on (Enterprise only), a new order that
would take the customer over the limit either goes through and the owner is
told ("warn"), or is refused until an owner or admin approves it ("block").
What a customer owes is their unpaid invoice balances plus orders not yet
invoiced.

Orders synced from the desktop app don't pass through here.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.automation import AutomationRule
from ..models.company import Company
from ..models.sales import Invoice, SalesOrder
from ..models.supplier_customer import Customer
from ..models.user import User
from .base import Notice
from .format import peso

RECIPE = "credit_guard"
APPROVER_ROLES = ("owner", "admin")
OPEN_INVOICE = ("unpaid", "partial", "overdue")


def owed(db: Session, customer_ids: list[uuid.UUID] | None = None) -> dict[uuid.UUID, Decimal]:
    """What each customer owes: unpaid invoice balances plus orders not yet
    invoiced (drafts, cancellations and paid orders aside)."""
    balances: dict[uuid.UUID, Decimal] = {}
    invoices = db.query(Invoice.customer_id, func.sum(Invoice.total_amount - Invoice.paid_amount)).filter(
        Invoice.status.in_(OPEN_INVOICE), Invoice.customer_id.isnot(None)
    )
    invoiced = db.query(Invoice.id).filter(Invoice.order_id == SalesOrder.id).exists()
    orders = db.query(SalesOrder.customer_id, func.sum(SalesOrder.total_amount)).filter(
        SalesOrder.status.notin_(("draft", "cancelled", "paid")),
        SalesOrder.customer_id.isnot(None),
        ~invoiced,
    )
    if customer_ids is not None:
        invoices = invoices.filter(Invoice.customer_id.in_(customer_ids))
        orders = orders.filter(SalesOrder.customer_id.in_(customer_ids))
    for query in (invoices.group_by(Invoice.customer_id), orders.group_by(SalesOrder.customer_id)):
        for customer_id, amount in query.all():
            if customer_id is None:  # filtered out above; the column itself is nullable
                continue
            balances[customer_id] = balances.get(customer_id, Decimal(0)) + Decimal(amount or 0)
    return balances


@dataclass(frozen=True)
class OverLimit:
    """An order that would take a customer over their limit."""

    mode: str  # "warn" or "block"
    customer: str
    limit: Decimal
    owed: Decimal  # before this order
    adding: Decimal

    def describe(self) -> str:
        return (
            f"{self.customer} would owe {peso(self.owed + self.adding)} with this {peso(self.adding)} order, "
            f"over their {peso(self.limit)} credit limit. They owe {peso(self.owed)} now."
        )


def check(db: Session, company_id: uuid.UUID, customer_id: uuid.UUID, adding: Decimal) -> OverLimit | None:
    """The guard's verdict on a new order, or None when the guard is off, the
    tenant isn't entitled, the customer has no limit, or the order fits."""
    from . import engine
    from .recipes import RECIPES

    rule = db.query(AutomationRule).filter(AutomationRule.recipe == RECIPE, AutomationRule.enabled.is_(True)).first()
    if rule is None or not engine.entitled(db, company_id):
        return None
    customer = db.get(Customer, customer_id)
    if customer is None or not customer.credit_limit or customer.credit_limit <= 0:
        return None
    balance = owed(db, [customer_id]).get(customer_id, Decimal(0))
    if balance + adding <= customer.credit_limit:
        return None
    params = engine.parse_params(RECIPES[RECIPE], rule.params)
    return OverLimit(
        mode=getattr(params, "mode", "warn"),
        customer=customer.name,
        limit=Decimal(customer.credit_limit),
        owed=balance,
        adding=Decimal(adding),
    )


def can_approve(user: User) -> bool:
    return bool(user.role and user.role.name in APPROVER_ROLES)


def report(db: Session, company: Company, over: OverLimit, order: SalesOrder, user: User, *, approved: bool) -> None:
    """Tell the guard's recipients about an order taken over the limit. Doesn't commit."""
    from . import engine
    from .recipes import RECIPES

    recipe = RECIPES[RECIPE]
    rule = db.query(AutomationRule).filter(AutomationRule.recipe == RECIPE).first()
    params = engine.parse_params(recipe, rule.params if rule else None)
    who = user.full_name or user.username
    how = f"Approved over the limit by {who}." if approved else f"Entered by {who}."
    notice = Notice(
        title=f"Order over credit limit: {order.order_no}",
        body=f"{over.describe()}\n{how}",
        link="/sales",
        dedupe_key=f"{RECIPE}:order:{order.id}",
    )
    recipients = engine.recipient_ids(db, company.id, recipe, rule.recipients if rule else [])
    engine.deliver(db, company, recipe, [notice], recipients, email=bool(getattr(params, "email", True)))
