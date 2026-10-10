import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import now_utc


class CollectionFollowUp(Base):
    """What happened when the mill chased a customer for money (Enterprise,
    with the automations): called, no answer, a reminder sent, a promise to pay
    by a date, paid, or disputed.

    The collections list ranks customers by what they owe and reads the latest
    of these: a promise not kept by its date comes first, one still in the
    future waits its turn.
    """

    __tablename__ = "collection_follow_ups"
    __table_args__ = (Index("ix_collection_follow_ups_customer_created", "customer_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False
    )
    # called | no_answer | reminder_sent | promised | paid | disputed
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    promised_date: Mapped[date | None] = mapped_column(Date)
    promised_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    note: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
