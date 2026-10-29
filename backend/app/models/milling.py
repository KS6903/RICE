import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin

if TYPE_CHECKING:
    from .reference import QualityGrade, RiceVariety
    from .user import User


class MillingEquipment(Base):
    __tablename__ = "milling_equipment"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str | None] = mapped_column(String(100))
    capacity_kg_per_hr: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class MillingBatch(Base, TimestampMixin):
    __tablename__ = "milling_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    batch_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    equipment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("milling_equipment.id"))
    operator_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # The client whose palay this is (custom milling); None when it's the mill's own.
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"))
    # What the client and the mill agreed: client_takes_all, mill_keeps_byproducts
    # or contracted, with the terms in client_notes. None for the mill's own palay.
    client_arrangement: Mapped[str | None] = mapped_column(String(30))
    client_notes: Mapped[str | None] = mapped_column(Text)
    start_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress, completed, cancelled
    remarks: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    equipment: Mapped["MillingEquipment"] = relationship("MillingEquipment")
    operator: Mapped["User"] = relationship("User", foreign_keys=[operator_id])
    inputs: Mapped[list["MillingBatchInput"]] = relationship(
        "MillingBatchInput", back_populates="batch", cascade="all, delete-orphan"
    )
    outputs: Mapped[list["MillingBatchOutput"]] = relationship(
        "MillingBatchOutput", back_populates="batch", cascade="all, delete-orphan"
    )


class MillingBatchInput(Base):
    __tablename__ = "milling_batch_inputs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("milling_batches.id", ondelete="CASCADE")
    )
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("quality_grades.id"))
    input_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    moisture_content_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))

    batch: Mapped["MillingBatch"] = relationship("MillingBatch", back_populates="inputs")
    variety: Mapped["RiceVariety"] = relationship("RiceVariety")
    grade: Mapped["QualityGrade"] = relationship("QualityGrade")


class MillingBatchOutput(Base):
    __tablename__ = "milling_batch_outputs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("milling_batches.id", ondelete="CASCADE")
    )
    output_type: Mapped[str] = mapped_column(String(20), nullable=False)  # milled_rice, ipa, darak, binlid
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    output_weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    broken_rice_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    milling_recovery_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))

    batch: Mapped["MillingBatch"] = relationship("MillingBatch", back_populates="outputs")
    variety: Mapped["RiceVariety"] = relationship("RiceVariety")


class MilledRiceInventory(Base):
    __tablename__ = "milled_rice_inventory"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("warehouses.id", ondelete="SET NULL")
    )
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_name: Mapped[str | None] = mapped_column(String(30))  # Graded Rice, Straight Mill Rice, Broken Rice, ...
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)

    variety: Mapped["RiceVariety"] = relationship("RiceVariety")


class ByproductInventory(Base):
    __tablename__ = "byproduct_inventory"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("warehouses.id", ondelete="SET NULL")
    )
    byproduct_type: Mapped[str] = mapped_column(String(20), nullable=False)  # ipa, darak, binlid
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
