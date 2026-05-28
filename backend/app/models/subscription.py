import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Boolean, Integer, Numeric, Text, DateTime, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from ..core.database import Base
from .base import TimestampMixin, now_utc


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    monthly_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    max_users: Mapped[int | None] = mapped_column(Integer)        # null = unlimited
    max_branches: Mapped[int | None] = mapped_column(Integer)     # null = unlimited
    features: Mapped[list] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Subscription(Base, TimestampMixin):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), unique=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription_plans.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active")  # trial, active, past_due, cancelled, expired
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    queued_plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription_plans.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    plan = relationship("SubscriptionPlan", foreign_keys=[plan_id])
    queued_plan = relationship("SubscriptionPlan", foreign_keys=[queued_plan_id])
