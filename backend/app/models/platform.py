import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import now_utc


class AdminAuditLog(Base):
    """Every change BossAdmin makes, and every "View as" visit: who, what, from
    where. Written on its own connection, so a change that fails is still on it.
    The app's database role may add rows and read them, never change or delete
    them (migration 035)."""

    __tablename__ = "admin_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # No foreign key: the record stays exactly as written, whatever happens to
    # the account later.
    admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    admin_username: Mapped[str] = mapped_column(String(50), nullable=False)
    # "admin.change" for a change through the console, or a named event:
    # "admin.confirmed", "admin.confirm_failed", "view_as.start".
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    method: Mapped[str | None] = mapped_column(String(10))
    path: Mapped[str | None] = mapped_column(String(300))
    # The mill it was about, when there was one.
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    detail: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False, index=True)


class PageRelease(Base):
    """How far a page of the app has been released (core/releases.py). A page
    with no row here is at the stage the code gives it."""

    __tablename__ = "page_releases"

    section: Mapped[str] = mapped_column(String(40), primary_key=True)
    stage: Mapped[str] = mapped_column(String(20), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
