import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, Boolean, Numeric, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
from ..core.database import Base
from .base import TimestampMixin


class PriceList(Base):
    __tablename__ = "price_lists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_name: Mapped[str | None] = mapped_column(String(30))
    customer_type: Mapped[str | None] = mapped_column(String(30))
    price_per_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    price_per_cavan: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    price_per_sack_50kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class SalesOrder(Base, TimestampMixin):
    __tablename__ = "sales_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    order_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"))
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    delivery_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft, confirmed, delivered, invoiced, paid
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    total_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # Courier assignment — agent OR miller, mutually exclusive (enforced in the API layer).
    assigned_agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id"))
    assigned_miller_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("millers.id"))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    customer: Mapped["Customer"] = relationship("Customer")
    assigned_agent: Mapped["Agent | None"] = relationship("Agent", foreign_keys=[assigned_agent_id])
    assigned_miller: Mapped["Miller | None"] = relationship("Miller", foreign_keys=[assigned_miller_id])
    items: Mapped[list["SalesOrderItem"]] = relationship("SalesOrderItem", back_populates="order", cascade="all, delete-orphan")
    invoices: Mapped[list["Invoice"]] = relationship("Invoice", back_populates="order")


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sales_orders.id", ondelete="CASCADE"))
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)  # milled_rice, byproduct
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_name: Mapped[str | None] = mapped_column(String(30))
    byproduct_type: Mapped[str | None] = mapped_column(String(20))
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    unit_price_per_kg: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)

    order: Mapped["SalesOrder"] = relationship("SalesOrder", back_populates="items")
    variety: Mapped["RiceVariety"] = relationship("RiceVariety")

    @property
    def line_total(self) -> Decimal:
        return self.quantity_kg * self.unit_price_per_kg


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    invoice_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("sales_orders.id"))
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"))
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[str] = mapped_column(String(20), default="unpaid")  # unpaid, partial, paid, overdue
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    order: Mapped["SalesOrder"] = relationship("SalesOrder", back_populates="invoices")
    customer: Mapped["Customer"] = relationship("Customer")
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="invoice")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id"))
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False)  # cash, gcash, bank_transfer, check
    reference_no: Mapped[str | None] = mapped_column(String(50))
    received_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="payments")
