import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


class RiceVariety(Base):
    __tablename__ = "rice_varieties"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str | None] = mapped_column(String(20))  # inbred, hybrid, local
    typical_recovery_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class QualityGrade(Base):
    __tablename__ = "quality_grades"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    code: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    min_moisture_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    max_moisture_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    description: Mapped[str | None] = mapped_column(Text)


class ByproductType(Base):
    __tablename__ = "byproduct_types"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)  # ipa, darak, binlid
    local_name: Mapped[str | None] = mapped_column(String(50))


class ByproductKind(Base):
    """A by-product a mill handles beyond the three every mill has (ipa, darak
    and binlid, services/byproduct_kind_service.BUILT_IN): carbonized hull,
    first-class bran, … Stock, purchases and sales lines keep its code; the name
    is what the pages show, so renaming it never touches them."""

    __tablename__ = "byproduct_kinds"
    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_byproduct_kinds_company_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    # Hidden ones stay on the records that have them, just not in the pickers.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
