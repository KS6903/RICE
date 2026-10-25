import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import TimestampMixin


class PlanPayment(Base, TimestampMixin):
    """One online payment for a plan: a PayMongo checkout (pesos) or a PayPal
    order (US dollars). Paid, it moves the mill onto the plan by itself
    (services/payment_service.py). Public schema: the provider's webhook
    arrives with no mill attached, and the record outlives a deleted mill."""

    __tablename__ = "plan_payments"
    __table_args__ = (
        Index("ix_plan_payments_company_id", "company_id"),
        Index("uq_plan_payments_provider_ref", "provider", "provider_ref", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL")
    )
    # Kept as written at the time, for the books, should the mill be deleted.
    company_name: Mapped[str] = mapped_column(String(200))
    plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription_plans.id"))
    plan_name: Mapped[str] = mapped_column(String(100))
    billing_interval: Mapped[str] = mapped_column(String(10))  # monthly, annual
    provider: Mapped[str] = mapped_column(String(20))  # paymongo, paypal
    currency: Mapped[str] = mapped_column(String(3))  # PHP, USD
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, paid, failed
    # The provider's checkout session (PayMongo cs_...) or order id (PayPal).
    provider_ref: Mapped[str | None] = mapped_column(String(100))
    # The provider's own payment or capture id, once paid.
    provider_payment_id: Mapped[str | None] = mapped_column(String(100))
    checkout_url: Mapped[str | None] = mapped_column(String(1000))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    plan = relationship("SubscriptionPlan")
