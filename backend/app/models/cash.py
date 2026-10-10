import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import TimestampMixin


class CashCount(Base, TimestampMixin):
    """The cash drawer counted at the end of a day (Enterprise, with the
    automations): what should be there against what is.

    expected = opening + cash_in - cash_out, where cash_in is the day's cash
    payments as recorded (worked out when the count is saved) and cash_out is
    what the counter says left the drawer (palay paid in cash, expenses). The
    next day opens with counted - taken_out (money banked or handed to the
    owner at close). A difference beyond the tolerance needs an owner or admin
    to review it (reviewed_at), with a note of what they found.
    """

    __tablename__ = "cash_counts"
    __table_args__ = (UniqueConstraint("count_date", name="uq_cash_counts_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    count_date: Mapped[date] = mapped_column(Date, nullable=False)
    opening: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    cash_in: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    cash_out: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    counted: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    taken_out: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(String(500))
    counted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    review_note: Mapped[str | None] = mapped_column(String(500))

    @property
    def expected(self) -> Decimal:
        return Decimal(self.opening) + Decimal(self.cash_in) - Decimal(self.cash_out)

    @property
    def difference(self) -> Decimal:
        """Counted less expected: below zero is short, above is over."""
        return Decimal(self.counted) - self.expected
