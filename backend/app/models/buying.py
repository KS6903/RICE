"""Rice (bigas) and by-product purchases: bought in like palay, straight into stock.

The palay purchase (models/paddy.py) is the template: a purchase header with its
supplier, date, delivery and warehouse, and one row per line bought. What differs
is how each is counted. Rice is bought by the sack (price per sack); by-products
by weight (price per kg). Neither carries tare or moisture: rice comes bagged and
weighed, by-products by the kilo.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin

if TYPE_CHECKING:
    from .company import Branch
    from .reference import RiceVariety
    from .supplier_customer import Supplier
    from .user import User
    from .warehouse import Warehouse


class RicePurchase(Base, TimestampMixin):
    __tablename__ = "rice_purchases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("warehouses.id", ondelete="SET NULL")
    )
    reference_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"))
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    delivery_type: Mapped[str | None] = mapped_column(String(20))  # delivered, picked_up
    status: Mapped[str] = mapped_column(String(20), default="received")
    remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    items: Mapped[list["RicePurchaseItem"]] = relationship(
        "RicePurchaseItem", back_populates="purchase", cascade="all, delete-orphan"
    )
    supplier: Mapped["Supplier"] = relationship("Supplier")
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    branch: Mapped["Branch | None"] = relationship("Branch")
    warehouse: Mapped["Warehouse | None"] = relationship("Warehouse")


class RicePurchaseItem(Base):
    __tablename__ = "rice_purchase_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rice_purchases.id", ondelete="CASCADE")
    )
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_name: Mapped[str | None] = mapped_column(String(30))  # a milled-rice grade, as milled stock
    sack_count: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    kg_per_sack: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=Decimal("50"))
    price_per_sack: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    purchase: Mapped["RicePurchase"] = relationship("RicePurchase", back_populates="items")
    variety: Mapped["RiceVariety"] = relationship("RiceVariety")

    @property
    def weight_kg(self) -> Decimal:
        return self.sack_count * self.kg_per_sack

    @property
    def total_amount(self) -> Decimal:
        return self.sack_count * self.price_per_sack


class ByproductPurchase(Base, TimestampMixin):
    __tablename__ = "byproduct_purchases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("warehouses.id", ondelete="SET NULL")
    )
    reference_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"))
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    delivery_type: Mapped[str | None] = mapped_column(String(20))  # delivered, picked_up
    status: Mapped[str] = mapped_column(String(20), default="received")
    remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    items: Mapped[list["ByproductPurchaseItem"]] = relationship(
        "ByproductPurchaseItem", back_populates="purchase", cascade="all, delete-orphan"
    )
    supplier: Mapped["Supplier"] = relationship("Supplier")
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    branch: Mapped["Branch | None"] = relationship("Branch")
    warehouse: Mapped["Warehouse | None"] = relationship("Warehouse")


class ByproductPurchaseItem(Base):
    __tablename__ = "byproduct_purchase_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("byproduct_purchases.id", ondelete="CASCADE")
    )
    byproduct_type: Mapped[str] = mapped_column(String(20), nullable=False)  # ipa, darak, binlid, …
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    price_per_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    purchase: Mapped["ByproductPurchase"] = relationship("ByproductPurchase", back_populates="items")

    @property
    def total_amount(self) -> Decimal:
        return self.weight_kg * self.price_per_kg
