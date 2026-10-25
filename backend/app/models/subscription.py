import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin, now_utc


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    monthly_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    annual_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    # What a yearly subscriber saves off 12 months of the monthly price. The
    # annual price is worked out from it (services.subscription.annual_price).
    # Four places so "2 months free" (16.6667%) lands on monthly x 10 exactly.
    annual_discount_percent: Mapped[Decimal] = mapped_column(
        Numeric(7, 4), default=0, server_default="0", nullable=False
    )
    max_users: Mapped[int | None] = mapped_column(Integer)  # null = unlimited
    max_branches: Mapped[int | None] = mapped_column(Integer)  # null = unlimited
    features: Mapped[list] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Where a mill sends the money for this plan, shown on its checkout page.
    # Kept here, not in the code, so the account numbers stay out of the repo.
    payment_bank: Mapped[str | None] = mapped_column(String(100))
    payment_account_name: Mapped[str | None] = mapped_column(String(150))
    payment_account_number: Mapped[str | None] = mapped_column(String(50))


class Subscription(Base, TimestampMixin):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), unique=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription_plans.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active")  # trial, active, past_due, cancelled, expired
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    queued_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscription_plans.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    plan = relationship("SubscriptionPlan", foreign_keys=[plan_id])
    queued_plan = relationship("SubscriptionPlan", foreign_keys=[queued_plan_id])
