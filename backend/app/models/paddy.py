import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin

if TYPE_CHECKING:
    from .company import Branch
    from .reference import QualityGrade, RiceVariety
    from .supplier_customer import Supplier
    from .user import User
    from .warehouse import Warehouse

# A cavan of palay, and what a sack is taken to weigh when nobody weighed it.
KG_PER_CAVAN = Decimal("50")


class PalayPurchase(Base, TimestampMixin):
    __tablename__ = "palay_purchases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("warehouses.id", ondelete="SET NULL")
    )
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
    warehouse: Mapped["Warehouse | None"] = relationship("Warehouse")
    recovery_tests: Mapped[list["PalayRecoveryTest"]] = relationship(
        "PalayRecoveryTest",
        back_populates="purchase",
        cascade="all, delete-orphan",
        order_by="PalayRecoveryTest.created_at.desc()",
    )


class PalayPurchaseItem(Base):
    __tablename__ = "palay_purchase_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("palay_purchases.id", ondelete="CASCADE")
    )
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("quality_grades.id"))
    # What was bought, counted in sacks. Cavans and kilos are optional: when the
    # kilos weren't weighed they are taken from the cavans, or else the sacks.
    sack_count: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    gross_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    tare_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    cavan_count: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    # Moisture when bought; for wet palay, the moisture before drying.
    moisture_content_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    price_per_cavan: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # Bought wet: counted in stock at its wet weight until the after-drying weight
    # and moisture are recorded, and the line is then complete.
    is_wet: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    dried_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    dried_moisture_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    dried_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    purchase: Mapped["PalayPurchase"] = relationship("PalayPurchase", back_populates="items")
    variety: Mapped["RiceVariety"] = relationship("RiceVariety")
    grade: Mapped["QualityGrade"] = relationship("QualityGrade")

    @property
    def net_weight_kg(self) -> Decimal:
        return self.gross_weight_kg - self.tare_weight_kg

    @property
    def is_drying(self) -> bool:
        """Bought wet and not yet dried: the red ones."""
        return self.is_wet and self.dried_weight_kg is None

    @property
    def stock_weight_kg(self) -> Decimal:
        """What this line holds in stock: the dried weight once it is dry."""
        return self.dried_weight_kg if self.dried_weight_kg is not None else self.net_weight_kg

    @property
    def total_amount(self) -> Decimal:
        # Paid on the weight it was bought at, wet or not.
        return (self.net_weight_kg / KG_PER_CAVAN) * self.price_per_cavan


class PalayRecoveryTest(Base, TimestampMixin):
    """A milling-recovery test on a purchase's palay: a sample weighed in and what
    came out of it. It hangs on the purchase, not on a line, so correcting the
    lines (which replaces them) keeps it; the variety says which line was tested."""

    __tablename__ = "palay_recovery_tests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("palay_purchases.id", ondelete="CASCADE"), nullable=False
    )
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    sample_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    # The sample's moisture, when it was read.
    sample_moisture_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Milled rice out, brokens included; the head rice (kernels at least three
    # quarters whole) is part of it. Husk and bran are what the milling took off.
    milled_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    head_rice_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    husk_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    bran_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    # Milled rice as a percent of the sample, and the head rice as a percent of it.
    recovery_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    head_rice_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    purchase: Mapped["PalayPurchase"] = relationship("PalayPurchase", back_populates="recovery_tests")
    variety: Mapped["RiceVariety | None"] = relationship("RiceVariety")
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by])


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
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("warehouses.id", ondelete="SET NULL")
    )
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
