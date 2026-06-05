"""Pydantic request schemas for the sales domain (Phase 3). Moved verbatim."""
import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class CustomerCreate(BaseModel):
    customer_type: str | None = None
    name: str
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    tin: str | None = None
    credit_limit: Decimal = Decimal("0")
    payment_terms_days: int = 0
    is_p20_accredited: bool = False


class CustomerUpdate(BaseModel):
    customer_type: str | None = None
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    tin: str | None = None
    credit_limit: Decimal | None = None
    payment_terms_days: int | None = None
    is_p20_accredited: bool | None = None
    is_active: bool | None = None


class OrderItemIn(BaseModel):
    item_type: str  # milled_rice, byproduct
    variety_id: uuid.UUID | None = None
    grade_name: str | None = None
    byproduct_type: str | None = None
    quantity_kg: Decimal
    unit_price_per_kg: Decimal


class OrderCreate(BaseModel):
    customer_id: uuid.UUID
    order_date: date
    delivery_date: date | None = None
    is_p20_sale: bool = False
    discount_pct: Decimal = Decimal("0")
    remarks: str | None = None
    items: list[OrderItemIn]


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
