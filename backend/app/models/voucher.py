import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin, now_utc

# What a voucher gives (services/vouchers.py).
FREE_TIME = "free_time"  # a plan for free_months + free_days, no payment
PERCENT_OFF = "percent_off"  # percent off one payment for a plan
AMOUNT_OFF = "amount_off"  # pesos (and dollars, if set) off one payment
KINDS = (FREE_TIME, PERCENT_OFF, AMOUNT_OFF)


class Voucher(Base, TimestampMixin):
    """A code BossAdmin gives out. Locked to one mill (company_id), it works for
    that mill only and can't be passed on; each mill uses a voucher once
    (VoucherRedemption). Public schema: BossAdmin and every mill read it."""

    __tablename__ = "vouchers"
    __table_args__ = (
        CheckConstraint("kind IN ('free_time', 'percent_off', 'amount_off')", name="ck_vouchers_kind"),
        CheckConstraint("percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)", name="ck_vouchers_pct"),
        CheckConstraint("amount_off IS NULL OR amount_off > 0", name="ck_vouchers_amount"),
        CheckConstraint("amount_off_usd IS NULL OR amount_off_usd > 0", name="ck_vouchers_amount_usd"),
        CheckConstraint("free_months >= 0 AND free_days >= 0", name="ck_vouchers_free_time"),
        CheckConstraint("max_uses IS NULL OR max_uses > 0", name="ck_vouchers_max_uses"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stored upper case, as typed without spaces or dashes.
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # The plan it's for. Free time needs one; a discount without one is good
    # for any paid plan.
    plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription_plans.id"))
    # A discount for monthly or annual payments only; NULL is either.
    billing_interval: Mapped[str | None] = mapped_column(String(10))
    percent_off: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    amount_off: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    amount_off_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    free_months: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    free_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Locked to this mill: no other account can use it.
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    # How many mills in all may use it; NULL is no limit.
    max_uses: Mapped[int | None] = mapped_column(Integer)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    # BossAdmin's own note: who it's for, why.
    note: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    plan = relationship("SubscriptionPlan")
    company = relationship("Company")


class VoucherRedemption(Base):
    """One mill's use of a voucher. One per mill per voucher, held by the database."""

    __tablename__ = "voucher_redemptions"
    __table_args__ = (UniqueConstraint("voucher_id", "company_id", name="uq_voucher_redemptions_once"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    voucher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vouchers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL")
    )
    company_name: Mapped[str] = mapped_column(String(200), default="")
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription_plans.id"))
    # What it was worth: the discount taken (in currency), or free time (0).
    currency: Mapped[str | None] = mapped_column(String(3))
    discount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    plan_payment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("plan_payments.id"))
    upgrade_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscription_upgrade_requests.id")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
