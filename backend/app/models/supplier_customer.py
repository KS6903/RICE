import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin, now_utc


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"
    __table_args__ = (
        # One colour per party per tenant; services/canva_color.py checks across the four tables.
        Index(
            "uq_suppliers_company_color",
            "company_id",
            "canva_color_hex",
            unique=True,
            postgresql_where=text("canva_color_hex IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    supplier_type: Mapped[str | None] = mapped_column(String(20))  # farmer, trader, cooperative
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(150))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    municipality: Mapped[str | None] = mapped_column(String(100))
    province: Mapped[str | None] = mapped_column(String(100))
    farmer_id: Mapped[str | None] = mapped_column(String(50))  # RSBSA or PhilSys ID
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    canva_color_hex: Mapped[str | None] = mapped_column(String(7))


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"
    __table_args__ = (
        # One colour per party per tenant; services/canva_color.py checks across the four tables.
        Index(
            "uq_customers_company_color",
            "company_id",
            "canva_color_hex",
            unique=True,
            postgresql_where=text("canva_color_hex IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    customer_type: Mapped[str | None] = mapped_column(String(30))  # wholesaler, retailer, government, walk_in
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(150))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    tin: Mapped[str | None] = mapped_column(String(20))
    credit_limit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    canva_color_hex: Mapped[str | None] = mapped_column(String(7))


class SupplierAdvance(Base, TimestampMixin):
    """A vale: cash or farm inputs given to a farmer ahead of the harvest, taken off
    what the mill pays when the palay is delivered. What's still owed is the amount
    less its settlements."""

    __tablename__ = "supplier_advances"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    supplier_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False)
    advance_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="cash")  # cash, inputs
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))
    is_void: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    supplier: Mapped["Supplier"] = relationship("Supplier")
    settlements: Mapped[list["AdvanceSettlement"]] = relationship(
        "AdvanceSettlement", back_populates="advance", cascade="all, delete-orphan"
    )


class AdvanceSettlement(Base):
    """Part of a vale taken off a palay purchase."""

    __tablename__ = "advance_settlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    advance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("supplier_advances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("palay_purchases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    advance: Mapped["SupplierAdvance"] = relationship("SupplierAdvance", back_populates="settlements")
