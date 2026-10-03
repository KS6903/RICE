import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import TimestampMixin


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
