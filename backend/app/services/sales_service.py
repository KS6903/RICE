"""SalesService — business logic for the sales domain (Phase 3).

Customers, price list, and the order -> invoice -> payment money flow:
order totals + numbering, invoicing (which advances the order status), and
payment posting (which advances invoice/order status). The service owns each
transaction; repositories flush only.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from ..automations import credit
from ..core.exceptions import ConflictError, NotFoundError
from ..models.reference import RiceVariety
from ..models.sales import Invoice, Payment, PriceList, SalesOrder, SalesOrderItem
from ..models.supplier_customer import Customer
from ..repositories.sales import (
    CustomerRepository,
    InvoiceRepository,
    PriceListRepository,
    SalesOrderRepository,
)
from ..services import stock_ledger
from ..services.base import BaseService
from ..services.canva_color import pick_unused_color
from ..services.delivery_rules import check_can_unmark, has_courier
from ..services.doc_numbers import mill_code
from ..services.record_changes import changed_fields, log_changes, show

# What each record's change log names, field by field.
CUSTOMER_FIELDS = {
    "name": "Name",
    "customer_type": "Type",
    "contact_person": "Contact person",
    "phone": "Phone",
    "address": "Address",
    "tin": "TIN",
    "credit_limit": "Credit limit (₱)",
    "payment_terms_days": "Payment terms (days)",
    "is_active": "Active",
}
ORDER_FIELDS = {
    "customer": "Customer",
    "order_date": "Order date",
    "delivery_date": "Delivery date",
    "status": "Status",
    "discount_pct": "Discount %",
    "remarks": "Remarks",
    "items": "Items",
    "total_amount": "Total (₱)",
}
INVOICE_FIELDS = {
    "invoice_date": "Invoice date",
    "due_date": "Due date",
    "customer": "Customer",
    "total_amount": "Total (₱)",
    "status": "Status",
}


def _customer_state(c: Customer) -> dict:
    return {f: getattr(c, f) for f in CUSTOMER_FIELDS}


def _item_text(i: SalesOrderItem) -> str:
    if i.item_type == "byproduct":
        what = i.byproduct_type or "by-product"
    else:
        code = i.variety.code if i.variety is not None else None
        what = " ".join(x for x in (code, i.grade_name) if x) or i.item_type.replace("_", " ")
    return f"{what} {show(i.quantity_kg)} kg at ₱{show(i.unit_price_per_kg)}"


def _order_state(o: SalesOrder) -> dict:
    return {
        "customer": o.customer.name if o.customer is not None else None,
        "order_date": o.order_date,
        "delivery_date": o.delivery_date,
        "status": o.status,
        "discount_pct": o.discount_pct,
        "remarks": o.remarks,
        "items": "; ".join(_item_text(i) for i in o.items),
        "total_amount": o.total_amount,
    }


def _invoice_state(inv: Invoice) -> dict:
    return {
        "invoice_date": inv.invoice_date,
        "due_date": inv.due_date,
        "customer": inv.customer.name if inv.customer is not None else None,
        "total_amount": inv.total_amount,
        "status": inv.status,
    }


def _payment_status(inv: Invoice) -> str:
    """An invoice's status from what has been paid against its total, as
    record_payment sets it. Overdue stays overdue until it's paid; the nightly
    job marks new ones."""
    paid = inv.paid_amount or 0
    if inv.total_amount is not None and paid >= inv.total_amount:
        return "paid"
    if inv.status == "overdue":
        return "overdue"
    return "partial" if paid > 0 else "unpaid"


class SalesService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        customers: CustomerRepository,
        prices: PriceListRepository,
        orders: SalesOrderRepository,
        invoices: InvoiceRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.customers = customers
        self.prices = prices
        self.orders = orders
        self.invoices = invoices

    # ── customers ─────────────────────────────────────────────────────────────

    def list_customers(self, *, include_inactive: bool = False) -> Sequence[Customer]:
        return self.customers.list_for_company(self.current_user.company_id, include_inactive=include_inactive)

    def create_customer(self, data) -> Customer:
        color = pick_unused_color(self.db, self.current_user.company_id)
        customer = Customer(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            canva_color_hex=color,
            **data.model_dump(),
        )
        with self.transaction():
            self.customers.add(customer)
        self.db.refresh(customer)
        return customer

    def update_customer(self, customer_id: uuid.UUID, data) -> Customer:
        c = self.customers.get_for_company(customer_id, self.current_user.company_id)
        if not c:
            raise NotFoundError("Customer not found")
        before = _customer_state(c)
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(c, field, val)
            lines = changed_fields(before, _customer_state(c), CUSTOMER_FIELDS)
            self._log("customer.edit", "customer", c.id, c.name, lines)
        self.db.refresh(c)
        return c

    # ── price list ────────────────────────────────────────────────────────────

    def list_prices(self) -> Sequence[PriceList]:
        return self.prices.list_active_for_company(self.current_user.company_id)

    # ── orders ────────────────────────────────────────────────────────────────

    @staticmethod
    def serialize_order(o: SalesOrder) -> dict:
        """The order's columns, plus its customer and line items (what the orders
        table and the invoice preview show)."""
        data = {c.name: getattr(o, c.name) for c in o.__table__.columns}
        c = o.customer
        data["customer"] = (
            {
                "id": c.id,
                "name": c.name,
                "address": c.address,
                "tin": c.tin,
                "payment_terms_days": c.payment_terms_days,
            }
            if c
            else None
        )
        data["items"] = [
            {
                "id": i.id,
                "item_type": i.item_type,
                "variety_id": i.variety_id,
                "variety_code": i.variety.code if i.variety else None,
                "variety_name": i.variety.name if i.variety else None,
                "grade_name": i.grade_name,
                "byproduct_type": i.byproduct_type,
                "quantity_kg": i.quantity_kg,
                "unit_price_per_kg": i.unit_price_per_kg,
                "line_total": i.line_total,
            }
            for i in o.items
        ]
        # The latest invoice, if the order has been billed: what the detail popup
        # on the Buy & mill pages shows about payment.
        inv = max(o.invoices, key=lambda v: (v.invoice_date, v.created_at), default=None)
        data["invoice"] = (
            {
                "invoice_no": inv.invoice_no,
                "status": inv.status,
                "total_amount": inv.total_amount,
                "paid_amount": inv.paid_amount,
                "due_date": inv.due_date,
            }
            if inv
            else None
        )
        return data

    def list_orders(
        self, *, skip: int = 0, limit: int = 50, status: str | None = None, item_type: str | None = None
    ) -> Sequence[SalesOrder]:
        return self.orders.list_for_company(
            self.current_user.company_id, status=status, item_type=item_type, skip=skip, limit=limit
        )

    def create_order(self, data) -> SalesOrder:
        # IDOR guards: the customer must be ours; item varieties must be ours or
        # from the shared system catalog.
        self.assert_company_fk(Customer, data.customer_id, label="Customer")
        for i in data.items:
            self.assert_company_fk(RiceVariety, i.variety_id, label="Variety", allow_shared=True)
        subtotal = sum(i.quantity_kg * i.unit_price_per_kg for i in data.items)
        discount = subtotal * (data.discount_pct / 100)
        total = subtotal - discount
        # Enterprise credit-limit guard (automations): None unless it's on and
        # this order takes the customer over their limit.
        over = credit.check(self.db, self.current_user.company_id, data.customer_id, total)
        approved = bool(over and data.approve_over_limit and credit.can_approve(self.current_user))
        if over and over.mode == "block" and not approved:
            who = (
                "Approve it to go ahead."
                if credit.can_approve(self.current_user)
                else "An owner or admin can approve it."
            )
            raise ConflictError(f"{over.describe()} {who}", code="over_credit_limit")
        stock_ledger.check_holds(self.db, data.items, self.current_user.company_id, self.current_user.branch_id)
        with self.transaction():
            order = self.orders.add(
                SalesOrder(
                    company_id=self.current_user.company_id,
                    branch_id=self.current_user.branch_id,
                    order_no=self._next_order_no(),
                    customer_id=data.customer_id,
                    order_date=data.order_date,
                    delivery_date=data.delivery_date,
                    discount_pct=data.discount_pct,
                    discount_amount=discount,
                    subtotal=subtotal,
                    total_amount=total,
                    remarks=data.remarks,
                    status="confirmed",
                    created_by=self.current_user.id,
                )
            )
            for item in data.items:
                self.db.add(SalesOrderItem(order_id=order.id, **item.model_dump()))
            self.db.flush()
            self.db.expire(order, ["items"])
            stock_ledger.post_order(self.db, self.current_user, order)
            if over:
                credit.report(self.db, self.current_user.company, over, order, self.current_user, approved=approved)
        self.db.refresh(order)
        return order

    def update_order(self, order_id: uuid.UUID, body) -> SalesOrder:
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        new_status = body.model_dump(exclude_unset=True).get("status")
        # Delivered needs a courier here as much as on the Dispatch page...
        if new_status == "delivered" and not has_courier(order):
            raise ConflictError(
                "Choose who delivers it (the customer or the rice mill courier) before marking it delivered."
            )
        # ...and taking the mark back is the owner's, within the week, wherever it is done.
        if order.status == "delivered" and new_status is not None and new_status != "delivered":
            check_can_unmark(order, self.current_user)
        before = _order_state(order)
        with self.transaction():
            # Typed OrderUpdate schema: only validated, allowlisted fields arrive
            # here; exclude_unset preserves the old "only touch sent fields" semantics.
            for f, val in body.model_dump(exclude_unset=True).items():
                setattr(order, f, val)
            # Cancelling puts its goods back; taking the cancellation back takes them again.
            if new_status == "cancelled":
                stock_ledger.unpost_order(self.db, self.current_user, order, keep_posted=True)
            elif before["status"] == "cancelled" and new_status is not None and order.stock_posted_at is not None:
                stock_ledger.post_order(self.db, self.current_user, order)
            self._log_order(order, before)
        self.db.refresh(order)
        return order

    def edit_order(self, order_id: uuid.UUID, data) -> SalesOrder:
        """The Boss corrects a saved order: its customer, dates, discount,
        remarks and lines. The totals follow, and so does its invoice: the new
        total, with what's already paid kept, and the status that leaves it in."""
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        sent = data.model_dump(exclude_unset=True)
        if "customer_id" in sent:
            self.assert_company_fk(Customer, data.customer_id, label="Customer")
        if data.items is not None:
            for i in data.items:
                self.assert_company_fk(RiceVariety, i.variety_id, label="Variety", allow_shared=True)
        before = _order_state(order)
        invoices_before = {inv.id: _invoice_state(inv) for inv in order.invoices}
        with self.transaction():
            for f in ("customer_id", "order_date", "delivery_date", "discount_pct", "remarks"):
                if f in sent:
                    setattr(order, f, sent[f])
            if data.items is not None:
                # An order that moved stock moves it again as corrected.
                posted = order.stock_posted_at is not None and order.status != "cancelled"
                if posted:
                    stock_ledger.unpost_order(self.db, self.current_user, order)
                order.items = [SalesOrderItem(**i.model_dump()) for i in data.items]
                if posted:
                    stock_ledger.post_order(self.db, self.current_user, order)
            self.db.flush()
            self.db.expire(order, ["customer"])
            subtotal = sum((i.quantity_kg * i.unit_price_per_kg for i in order.items), Decimal(0))
            order.subtotal = subtotal
            order.discount_amount = subtotal * (order.discount_pct or 0) / 100
            order.total_amount = subtotal - order.discount_amount
            for inv in order.invoices:
                inv.customer_id = order.customer_id
                inv.total_amount = order.total_amount
                inv.status = _payment_status(inv)
                self.db.flush()
                self.db.expire(inv, ["customer"])
                lines = changed_fields(invoices_before[inv.id], _invoice_state(inv), INVOICE_FIELDS)
                if lines:
                    lines.append(f"Follows the edit to order {order.order_no}")
                self._log("invoice.edit", "invoice", inv.id, inv.invoice_no, lines)
                if inv.status == "paid":
                    order.status = "paid"
                elif order.status == "paid":
                    order.status = "invoiced"
            self._log_order(order, before)
        self.db.refresh(order)
        return order

    def _log_order(self, order: SalesOrder, before: dict) -> None:
        self.db.flush()
        self.db.expire(order, ["customer"])
        lines = changed_fields(before, _order_state(order), ORDER_FIELDS)
        self._log("sales_order.edit", "sales_order", order.id, order.order_no, lines)

    def _log(self, action: str, entity_type: str, entity_id: uuid.UUID, label: str | None, lines: list[str]) -> None:
        log_changes(
            self.db,
            user=self.current_user,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=label,
            lines=lines,
        )

    # ── invoices ──────────────────────────────────────────────────────────────

    def list_invoices(self, *, status: str | None = None) -> Sequence[Invoice]:
        return self.invoices.list_for_company(self.current_user.company_id, status=status)

    def create_invoice(self, data) -> Invoice:
        order = self.orders.get_for_company(data.order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        # Without an explicit due date, the invoice is due after the customer's
        # payment terms (0 days: on the invoice date). Before this, invoices
        # created without one never aged and never went overdue.
        terms = order.customer.payment_terms_days if order.customer is not None else 0
        due_date = data.due_date or data.invoice_date + timedelta(days=terms or 0)
        with self.transaction():
            inv = self.invoices.add(
                Invoice(
                    company_id=self.current_user.company_id,
                    branch_id=self.current_user.branch_id,
                    invoice_no=self._next_no("INV", self.invoices.count()),
                    order_id=order.id,
                    customer_id=order.customer_id,
                    invoice_date=data.invoice_date,
                    due_date=due_date,
                    total_amount=order.total_amount,
                    status="unpaid",
                    created_by=self.current_user.id,
                )
            )
            order.status = "invoiced"
        self.db.refresh(inv)
        return inv

    def edit_invoice(self, invoice_id: uuid.UUID, data) -> Invoice:
        """The Boss corrects a saved invoice's dates. Its amounts follow its order
        (edit the order to change them). Moving the due date out of the past
        takes the invoice off overdue; the nightly job marks it again if due."""
        inv = self.invoices.get_for_company(invoice_id, self.current_user.company_id)
        if not inv:
            raise NotFoundError("Invoice not found")
        before = _invoice_state(inv)
        with self.transaction():
            for f, val in data.model_dump(exclude_unset=True).items():
                setattr(inv, f, val)
            if inv.status == "overdue" and inv.due_date is not None and inv.due_date >= date.today():
                inv.status = "partial" if (inv.paid_amount or 0) > 0 else "unpaid"
            lines = changed_fields(before, _invoice_state(inv), INVOICE_FIELDS)
            self._log("invoice.edit", "invoice", inv.id, inv.invoice_no, lines)
        self.db.refresh(inv)
        return inv

    # ── payments ──────────────────────────────────────────────────────────────

    def record_payment(self, data) -> Payment:
        invoice = self.invoices.get_for_company(data.invoice_id, self.current_user.company_id)
        if not invoice:
            raise NotFoundError("Invoice not found")
        with self.transaction():
            payment = Payment(
                received_by=self.current_user.id,
                created_at=datetime.now(timezone.utc),
                **data.model_dump(),
            )
            self.db.add(payment)
            invoice.paid_amount += data.amount
            if invoice.paid_amount >= invoice.total_amount:
                invoice.status = "paid"
                if invoice.order:
                    invoice.order.status = "paid"
            elif invoice.paid_amount > 0 and invoice.status != "overdue":
                # A part payment on an overdue invoice leaves it overdue: the
                # balance is still late.
                invoice.status = "partial"
        self.db.refresh(payment)
        return payment

    # ── helpers ───────────────────────────────────────────────────────────────

    def _next_order_no(self) -> str:
        """RM1-0042: the mill's own code, then one more than its highest so far."""
        company = self.current_user.company
        code = mill_code(company.name if company else None)
        return f"{code}-{self.orders.last_number(code) + 1:04d}"

    @staticmethod
    def _next_no(prefix: str, existing_count: int) -> str:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"{prefix}-{today}-{existing_count + 1:04d}"


def mark_overdue_invoices(db: Session, *, today: date) -> int:
    """Mark unpaid and part-paid invoices past their due date overdue.

    Run nightly for every tenant by the invoices.mark_overdue job, in a session
    on that tenant's schema, with ``today`` as the tenant's local date. An
    invoice with no due date (created before due dates were defaulted) is due
    on its invoice date. Returns how many were marked. Does not commit.
    """
    result = db.execute(
        update(Invoice)
        .where(
            Invoice.status.in_(("unpaid", "partial")),
            func.coalesce(Invoice.due_date, Invoice.invoice_date) < today,
        )
        .values(status="overdue")
    )
    return result.rowcount  # type: ignore[attr-defined]
