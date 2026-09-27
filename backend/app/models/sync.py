import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


class SyncLog(Base):
    __tablename__ = "sync_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    table_name: Mapped[str] = mapped_column(String(60), nullable=False)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    operation: Mapped[str] = mapped_column(String(10), nullable=False)  # INSERT, UPDATE, DELETE
    payload: Mapped[dict | None] = mapped_column(JSONB)
    client_id: Mapped[str | None] = mapped_column(String(100))
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_conflict: Mapped[bool] = mapped_column(Boolean, default=False)


class SyncConflict(Base):
    __tablename__ = "sync_conflicts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    table_name: Mapped[str] = mapped_column(String(60), nullable=False)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    local_payload: Mapped[dict | None] = mapped_column(JSONB)
    remote_payload: Mapped[dict | None] = mapped_column(JSONB)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    resolution: Mapped[str | None] = mapped_column(String(20))  # keep_local, keep_remote, merged
