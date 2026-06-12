"""SalesService — business logic for the sales domain (Phase 3).

Customers, price list, and the order -> invoice -> payment money flow:
order totals + numbering, invoicing (which advances the order status), and
payment posting (which advances invoice/order status). The service owns each
transaction; repositories flush only.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError
from ..models.reference import RiceVariety
from ..models.sales import Invoice, Payment, PriceList, SalesOrder, SalesOrderItem
from ..models.supplier_customer import Customer
from ..repositories.sales import (
    CustomerRepository,
    InvoiceRepository,
    PriceListRepository,
    SalesOrderRepository,
)
from ..services.base import BaseService
from ..services.canva_color import pick_unused_color


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
        return self.customers.list_for_company(
            self.current_user.company_id, include_inactive=include_inactive
        )

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
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(c, field, val)
        self.db.refresh(c)
        return c

    # ── price list ────────────────────────────────────────────────────────────

    def list_prices(self) -> Sequence[PriceList]:
        return self.prices.list_active_for_company(self.current_user.company_id)

    # ── orders ────────────────────────────────────────────────────────────────

    def list_orders(self, *, skip: int = 0, limit: int = 50, status: str | None = None) -> Sequence[SalesOrder]:
        return self.orders.list_for_company(
            self.current_user.company_id, status=status, skip=skip, limit=limit
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
        with self.transaction():
            order = self.orders.add(
                SalesOrder(
                    company_id=self.current_user.company_id,
                    branch_id=self.current_user.branch_id,
                    order_no=self._next_no("SO", self.orders.count()),
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
        self.db.refresh(order)
        return order

    def update_order(self, order_id: uuid.UUID, body) -> SalesOrder:
        order = self.orders.get_for_company(order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        with self.transaction():
            # Typed OrderUpdate schema: only validated, allowlisted fields arrive
            # here; exclude_unset preserves the old "only touch sent fields" semantics.
            for f, val in body.model_dump(exclude_unset=True).items():
                setattr(order, f, val)
        self.db.refresh(order)
        return order

    # ── invoices ──────────────────────────────────────────────────────────────

    def list_invoices(self, *, status: str | None = None) -> Sequence[Invoice]:
        return self.invoices.list_for_company(self.current_user.company_id, status=status)

    def create_invoice(self, data) -> Invoice:
        order = self.orders.get_for_company(data.order_id, self.current_user.company_id)
        if not order:
            raise NotFoundError("Order not found")
        with self.transaction():
            inv = self.invoices.add(
                Invoice(
                    company_id=self.current_user.company_id,
                    branch_id=self.current_user.branch_id,
                    invoice_no=self._next_no("INV", self.invoices.count()),
                    order_id=order.id,
                    customer_id=order.customer_id,
                    invoice_date=data.invoice_date,
                    due_date=data.due_date,
                    total_amount=order.total_amount,
                    status="unpaid",
                    created_by=self.current_user.id,
                )
            )
            order.status = "invoiced"
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
            elif invoice.paid_amount > 0:
                invoice.status = "partial"
        self.db.refresh(payment)
        return payment

    # ── helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _next_no(prefix: str, existing_count: int) -> str:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"{prefix}-{today}-{existing_count + 1:04d}"
