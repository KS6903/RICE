import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin

if TYPE_CHECKING:
    from .company import Branch
    from .reference import QualityGrade, RiceVariety
    from .supplier_customer import Supplier
    from .user import User


class PalayPurchase(Base, TimestampMixin):
    __tablename__ = "palay_purchases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    reference_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"))
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    delivery_type: Mapped[str | None] = mapped_column(String(20))  # farm_gate, delivered
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft, received, completed, cancelled
    remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    items: Mapped[list["PalayPurchaseItem"]] = relationship(
        "PalayPurchaseItem", back_populates="purchase", cascade="all, delete-orphan"
    )
    supplier: Mapped["Supplier"] = relationship("Supplier")
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    branch: Mapped["Branch | None"] = relationship("Branch")


class PalayPurchaseItem(Base):
    __tablename__ = "palay_purchase_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("palay_purchases.id", ondelete="CASCADE")
    )
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("quality_grades.id"))
    gross_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    tare_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    cavan_count: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    moisture_content_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    price_per_cavan: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    purchase: Mapped["PalayPurchase"] = relationship("PalayPurchase", back_populates="items")
    variety: Mapped["RiceVariety"] = relationship("RiceVariety")
    grade: Mapped["QualityGrade"] = relationship("QualityGrade")

    @property
    def net_weight_kg(self) -> Decimal:
        return self.gross_weight_kg - self.tare_weight_kg

    @property
    def total_amount(self) -> Decimal:
        return (self.net_weight_kg / 50) * self.price_per_cavan


class DryingRecord(Base):
    __tablename__ = "drying_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("palay_purchase_items.id")
    )
    start_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    initial_moisture_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    final_moisture_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    drying_method: Mapped[str | None] = mapped_column(String(20))  # sun_dry, mechanical
    drying_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    operator_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))


class PalayInventory(Base):
    __tablename__ = "palay_inventory"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("quality_grades.id"))
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)

    variety: Mapped["RiceVariety"] = relationship("RiceVariety")
    grade: Mapped["QualityGrade"] = relationship("QualityGrade")


class PalayInventoryMovement(Base):
    __tablename__ = "palay_inventory_movements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    inventory_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("palay_inventory.id"))
    movement_type: Mapped[str] = mapped_column(String(20), nullable=False)  # in, out, adjustment
    source_type: Mapped[str | None] = mapped_column(String(30))  # purchase, milling_batch, adjustment
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    balance_after_kg: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
