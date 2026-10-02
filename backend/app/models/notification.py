import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import now_utc


class Notification(Base):
    """A notice for one user: listed under the bell in the web app, and emailed
    when whoever produced it asked for that.

    Scheduled jobs produce these (and, for Enterprise tenants, the automations).
    (user_id, dedupe_key) is unique, so producing the same notice twice is a
    no-op: a job retried after a crash never repeats a message.
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. subscription.expiring
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(300))  # in-app path, e.g. /settings
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False)
    # none: in-app only. pending: waiting to be emailed. sent | failed | skipped
    # (skipped: the user has no email address, or email isn't configured in dev).
    email_status: Mapped[str] = mapped_column(String(16), nullable=False, default="none")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now(), nullable=False
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_dedupe"),
        Index("ix_notifications_user_unread", "user_id", "read_at", "created_at"),
    )


class NotificationAttachment(Base):
    """A file emailed with every notice that has this dedupe key, such as a
    scheduled report's CSV. Kept once per notice, not once per recipient, and
    deleted after a couple of weeks by the notifications.prune_attachments job."""

    __tablename__ = "notification_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False)
    filename: Mapped[str] = mapped_column(String(120), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False, default="text/csv")
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("dedupe_key", "filename", name="uq_notification_attachments_key_file"),)
