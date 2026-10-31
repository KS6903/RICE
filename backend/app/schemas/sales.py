"""Pydantic request schemas for the sales domain (Phase 3). Moved verbatim."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class CustomerCreate(BaseModel):
    customer_type: str | None = None
    name: str
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    tin: str | None = None
    credit_limit: Decimal = Decimal("0")
    payment_terms_days: int = 0


class CustomerUpdate(BaseModel):
    customer_type: str | None = None
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    tin: str | None = None
    credit_limit: Decimal | None = None
    payment_terms_days: int | None = None
    is_active: bool | None = None


class OrderItemIn(BaseModel):
    # What the line sells: milled rice, a by-product, or palay (each has its own
    # page in Buy & mill, where it is bought on the left and sold on the right).
    item_type: Literal["milled_rice", "byproduct", "palay"]
    variety_id: uuid.UUID | None = None
    grade_name: str | None = None
    byproduct_type: str | None = None
    quantity_kg: Decimal = Field(gt=0)
    unit_price_per_kg: Decimal = Field(ge=0)


class OrderCreate(BaseModel):
    customer_id: uuid.UUID
    order_date: date
    delivery_date: date | None = None
    discount_pct: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    remarks: str | None = None
    items: list[OrderItemIn]
    # Only counts from an owner or admin, when the credit-limit guard would
    # otherwise stop the order (automations, Enterprise).
    approve_over_limit: bool = False
    approve_below_cost: bool = False


class OrderUpdate(BaseModel):
    """Replaces the old untyped ``body: dict`` on PUT /orders/{id} — only these
    fields are updatable, anything else in the payload is rejected/ignored by
    validation instead of silently reaching the service layer."""

    status: str | None = Field(None, max_length=30)
    delivery_date: date | None = None
    remarks: str | None = Field(None, max_length=2000)


class OrderEdit(BaseModel):
    """What the Boss can correct on a saved order. Only the fields sent change;
    items, when sent, replace all of the order's lines."""

    customer_id: uuid.UUID | None = None
    order_date: date | None = None
    delivery_date: date | None = None
    discount_pct: Decimal | None = Field(None, ge=0, le=100)
    remarks: str | None = Field(None, max_length=2000)
    items: list[OrderItemIn] | None = Field(None, min_length=1)


class InvoiceEdit(BaseModel):
    """What the Boss can correct on a saved invoice: its dates. Its amounts
    follow its order."""

    invoice_date: date | None = None
    due_date: date | None = None


class InvoiceCreate(BaseModel):
    order_id: uuid.UUID
    invoice_date: date
    due_date: date | None = None


class PaymentCreate(BaseModel):
    invoice_id: uuid.UUID
    payment_date: date
    amount: Decimal
    method: str
    reference_no: str | None = None
    notes: str | None = None
