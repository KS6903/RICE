import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import TimestampMixin


class ActionItem(Base, TimestampMixin):
    """A task made from an alert: who is fixing it, by when, and whether it's done
    (Enterprise, with the automations).

    A notice under the bell says something needs doing; reading it doesn't say
    anyone is doing it. An automation set to track its alerts makes one of these
    per alert, and anyone can make one from an alert by hand. source_key is the
    alert's dedupe key, so the same alert is never two tasks. Past due and not
    resolved, it is escalated to the owner and admins once (escalated_at).
    """

    __tablename__ = "action_items"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_action_items_source_key"),
        Index("ix_action_items_status_due", "status", "due_at"),
        Index("ix_action_items_assignee_status", "assignee_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    # The recipe that raised it (e.g. "wet_palay"), or "manual".
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    source_key: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(300))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Who assigned it; None when an automation did.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # open -> acknowledged ("I'm on it") -> resolved
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    resolution: Mapped[str | None] = mapped_column(String(500))
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
