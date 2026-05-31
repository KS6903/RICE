"""Spatial warehouse canvas models — Phase 1 of the visual inventory system."""
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, Integer, SmallInteger, Numeric, Text, DateTime, Date, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
from ..core.database import Base
from .base import TimestampMixin, now_utc


class WarehouseLayout(Base, TimestampMixin):
    """Spatial layout for a branch warehouse. A branch can have multiple layouts."""
    __tablename__ = "warehouse_layouts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_default: Mapped[bool] = mapped_column(default=True, nullable=False)
    width_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=30, nullable=False)
    height_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=20, nullable=False)
    grid_size_m: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=Decimal("0.5"), nullable=False)
    background_url: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    zones: Mapped[list["WarehouseZone"]] = relationship("WarehouseZone", back_populates="layout", cascade="all, delete-orphan")
    pallets: Mapped[list["Pallet"]] = relationship("Pallet", back_populates="layout", cascade="all, delete-orphan")


class WarehouseZone(Base):
    """Functional area inside a layout (intake, storage, dock, office)."""
    __tablename__ = "warehouse_zones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    layout_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouse_layouts.id", ondelete="CASCADE"), nullable=False)
    zone_type: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    x_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    y_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    width_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    height_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    rotation_deg: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    max_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    target_humidity_pct: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    target_temp_c: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    color_hex: Mapped[str] = mapped_column(String(7), default="#94a3b8", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    layout: Mapped["WarehouseLayout"] = relationship("WarehouseLayout", back_populates="zones")


class Pallet(Base, TimestampMixin):
    """Physical pallet on the warehouse floor — what gets dragged on the canvas."""
    __tablename__ = "pallets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    layout_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouse_layouts.id", ondelete="CASCADE"), nullable=False)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("warehouse_zones.id", ondelete="SET NULL"))
    pallet_code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    x_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    y_m: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    z_layer: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    stack_parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("pallets.id"))
    # Footprint defaults to a Euro-style 2.0 m × 1.2 m so pallets read at a glance
    # on a commercial-sized 30 × 120 m floor (the old 1.2 × 0.8 was too tiny to
    # spot at the natural zoom). Users can still resize via the canvas Transformer.
    width_m: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=Decimal("2.0"), nullable=False)
    depth_m: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=Decimal("1.2"), nullable=False)
    sack_count: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="in_storage", nullable=False)

    layout: Mapped["WarehouseLayout"] = relationship("WarehouseLayout", back_populates="pallets")
    zone: Mapped["WarehouseZone | None"] = relationship("WarehouseZone")
    batches: Mapped[list["RiceBatch"]] = relationship("RiceBatch", back_populates="pallet", cascade="all, delete-orphan")
    movements: Mapped[list["PalletMovement"]] = relationship("PalletMovement", back_populates="pallet", cascade="all, delete-orphan")
    stack_parent: Mapped["Pallet | None"] = relationship("Pallet", remote_side=[id], foreign_keys=[stack_parent_id])


class RiceBatch(Base):
    """The actual rice inside a pallet. A pallet can hold multiple batches."""
    __tablename__ = "rice_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    pallet_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pallets.id", ondelete="CASCADE"), nullable=False)
    milling_batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("milling_batches.id"))
    variety_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rice_varieties.id"))
    grade_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("quality_grades.id"))
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    client_type: Mapped[str | None] = mapped_column(String(20))
    client_name: Mapped[str | None] = mapped_column(String(150))
    sack_count: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    moisture_pct: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    milling_date: Mapped[date] = mapped_column(Date, nullable=False)
    best_before_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="fresh", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    pallet: Mapped["Pallet"] = relationship("Pallet", back_populates="batches")
    variety: Mapped["RiceVariety | None"] = relationship("RiceVariety")
    grade: Mapped["QualityGrade | None"] = relationship("QualityGrade")


class PalletMovement(Base):
    """Audit log: every drag, stack, dispatch."""
    __tablename__ = "pallet_movements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pallet_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pallets.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    movement_type: Mapped[str] = mapped_column(String(20), nullable=False)
    from_zone_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    to_zone_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    from_x_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    from_y_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    to_x_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    to_y_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    pallet: Mapped["Pallet"] = relationship("Pallet", back_populates="movements")
