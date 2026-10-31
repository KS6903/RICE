import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin


class StockCount(Base, TimestampMixin):
    """A physical count of the stock, set against the records (Enterprise, with
    the automations).

    The counter weighs or counts what's there without seeing what the records
    say; the recorded quantity of each line is taken when the count is saved.
    Lines out by more than the allowance wait for an owner or admin to review
    them. A count changes no stock: corrections are made in Inventory.
    """

    __tablename__ = "stock_counts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    # The branch counted, when the mill has several.
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    count_date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))
    counted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    review_note: Mapped[str | None] = mapped_column(String(500))

    lines: Mapped[list["StockCountLine"]] = relationship(
        "StockCountLine", back_populates="count", cascade="all, delete-orphan", order_by="StockCountLine.label"
    )


class StockCountLine(Base):
    """One item counted: what the records said when the count was saved, and
    what was there."""

    __tablename__ = "stock_count_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    count_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stock_counts.id", ondelete="CASCADE"), nullable=False
    )
    # milled_rice | palay | byproduct, and that inventory row's id.
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    inventory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    recorded_kg: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    counted_kg: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)

    count: Mapped[StockCount] = relationship("StockCount", back_populates="lines")

    @property
    def difference_kg(self) -> Decimal:
        """Counted less recorded: below zero is missing stock."""
        return Decimal(self.counted_kg) - Decimal(self.recorded_kg)
