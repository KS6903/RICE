import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin

if TYPE_CHECKING:
    from .user import User


def _default_schema_name() -> str:
    """A unique, SQL-safe schema name for a new client (tenant)."""
    return f"client_{uuid.uuid4().hex}"


class Company(Base, TimestampMixin):
    __tablename__ = "companies"
    __table_args__ = (
        # The provisioner's queue (migration 005); declared here so a fresh
        # database and an upgraded one end up identical.
        Index(
            "ix_companies_provisioning_queue",
            "provisioning_requested_at",
            postgresql_where=text("provisioned_at IS NULL AND provisioning_requested_at IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # ── Tenant routing (schema-per-client) ────────────────────────────────────
    # Each client's domain data lives in its own PostgreSQL schema. The default
    # auto-populates on insert, so every company-creation path gets one for free.
    schema_name: Mapped[str] = mapped_column(String(63), unique=True, nullable=False, default=_default_schema_name)
    address: Mapped[str | None] = mapped_column(Text)
    tin: Mapped[str | None] = mapped_column(String(20))
    nfa_license_no: Mapped[str | None] = mapped_column(String(50))
    da_registration_no: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    logo_url: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(String(3), default="PHP")
    timezone: Mapped[str] = mapped_column(String(50), default="Asia/Manila")
    is_multi_branch: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Closed by the mill's own Boss, not by Oraiza: paused, or with deletion asked
    # for (core/account_status.py). closed_by is the Boss's user id, kept without a
    # foreign key so companies and users don't gain a second join path.
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Changes this mill's Boss has made to what each staff role can open, as
    # {role: {page: "full" | "view" | "none"}}: only the cells that differ from
    # the default matrix (core/access_policy.py). NULL when nothing was changed.
    role_access: Mapped[dict | None] = mapped_column(JSONB)
    provisioning_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provisioned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provisioning_error: Mapped[str | None] = mapped_column(String(120))
    # Failed attempts so far, and when the next may run (core/provisioning.py).
    provisioning_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    provisioning_next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    branches: Mapped[list["Branch"]] = relationship("Branch", back_populates="company")
    users: Mapped[list["User"]] = relationship("User", back_populates="company")


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    is_main_branch: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Soft-delete: live when NULL, otherwise sitting in the 30-day trash until purged.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    company: Mapped["Company"] = relationship("Company", back_populates="branches")
    # foreign_keys is required because deleted_by also points at users.id,
    # giving SQLAlchemy two FK paths between branches and users.
    users: Mapped[list["User"]] = relationship("User", back_populates="branch", foreign_keys="[User.branch_id]")
