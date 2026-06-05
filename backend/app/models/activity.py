import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, func, Index
from sqlalchemy.orm import mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID
from ..core.database import Base
from .base import now_utc


class ActivityLog(Base):
    """Append-only audit trail of notable user actions (e.g. warehouse
    delete/restore/purge). Surfaced both in company Settings and the platform
    admin tenant-detail page. entity_label snapshots the affected entity's name
    so the log stays readable even after the entity is permanently purged."""

    __tablename__ = "activity_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(50), nullable=False)        # warehouse.delete | warehouse.restore | warehouse.purge
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)   # branch
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    entity_label: Mapped[str | None] = mapped_column(String(200))
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_activity_logs_company_created", "company_id", "created_at"),
    )
