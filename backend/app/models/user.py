import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin, now_utc

if TYPE_CHECKING:
    from .company import Branch, Company


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)

    users: Mapped[list["User"]] = relationship("User", back_populates="role")


class CompanyRole(Base):
    """A role a mill's Boss made up ("Warehouse Manager"), with the pages it can
    open. Unlike the built-in roles (``roles``), it belongs to one mill and has
    no default: ``access`` is its level on every page, as the Boss chose it
    (core/access_policy.py reads it). Someone with a custom role has no built-in
    role, so nothing that checks a role by name treats them as a Boss or an Admin.
    Lives in public, beside the users who hold it."""

    __tablename__ = "company_roles"
    __table_args__ = (Index("uq_company_roles_company_name", "company_id", "name", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    # {page: "full" | "view" | "none"}; a page missing from it is "none".
    access: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, server_default=func.now()
    )

    users: Mapped[list["User"]] = relationship("User", back_populates="custom_role")


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    # Which branch the top bar's picker opens on for a Boss or Admin: NULL for
    # the main branch, "all" for every branch together, or a branch id.
    default_branch_view: Mapped[str | None] = mapped_column(String(36))
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    role_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("roles.id"))
    # Instead of a built-in role: one the mill's Boss made up. A role that
    # still has people can't be deleted.
    custom_role_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("company_roles.id", ondelete="RESTRICT"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the Boss (or the platform admin) gives the user a temporary password
    # after a lockout. Until the user chooses their own, the API blocks data
    # endpoints; the temporary one stops working at temp_password_expires_at.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    temp_password_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # TOTP MFA. The seed is Fernet-encrypted at rest (core/crypto.py). A secret
    # with mfa_enabled=False is one of two things, told apart by mfa_last_used_step:
    # a pending enrollment awaiting its first code (step is None), or the earlier
    # authenticator kept when the user turned MFA off (step is set), which they can
    # switch back on with a fresh code from it instead of setting up a new one.
    mfa_secret: Mapped[str | None] = mapped_column(String(255))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Highest accepted TOTP time-step. Rejecting the same/lower step makes a
    # six-digit code single-use even within pyotp's clock-skew window. Kept when
    # MFA is turned off, so the code that turned it off can't turn it back on.
    mfa_last_used_step: Mapped[int | None] = mapped_column(BigInteger)
    # Bumped every time MFA is turned off or on. "Remember this device" tokens are
    # bound to it, so a device remembered before the change is asked again even
    # when the earlier secret comes back.
    mfa_epoch: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Single-use recovery codes — stored as SHA-256 hashes of the still-unused
    # codes; a code is removed from the list when consumed. Used when the user
    # can't reach their authenticator.
    mfa_backup_codes: Mapped[list | None] = mapped_column(JSONB)
    # Email verification. The token is a SHA-256 hash (the raw token is emailed),
    # cleared once consumed.
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_verification_hash: Mapped[str | None] = mapped_column(String(64))
    email_verification_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # External identities are bound to the provider's stable subject, never
    # auto-linked by a mutable email address alone.
    google_issuer: Mapped[str | None] = mapped_column(String(255))
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)

    company: Mapped["Company"] = relationship("Company", back_populates="users")
    branch: Mapped["Branch"] = relationship("Branch", back_populates="users", foreign_keys="[User.branch_id]")
    role: Mapped["Role"] = relationship("Role", back_populates="users")
    custom_role: Mapped["CompanyRole | None"] = relationship("CompanyRole", back_populates="users")
