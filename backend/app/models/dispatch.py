"""Dispatch-side party entities — delivery agents and third-party millers.

Shape mirrors `supplier_customer.py` so the canva color resolver can treat all
four party tables uniformly. Per-tenant color uniqueness is enforced by:
  - partial unique index on (company_id, canva_color_hex) for each table
  - app-layer cross-table check in services/canva_color.py
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Boolean, Text, Numeric, ForeignKey, DateTime
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import UUID
from ..core.database import Base
from .base import TimestampMixin


class Agent(Base, TimestampMixin):
    """Delivery agent or sales broker — typically external, paid per delivery."""
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    agent_type: Mapped[str | None] = mapped_column(String(30))  # broker, freelancer, logistics_co
    contact_person: Mapped[str | None] = mapped_column(String(150))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    commission_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    canva_color_hex: Mapped[str | None] = mapped_column(String(7))
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deactivated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    deactivated_by: Mapped["User | None"] = relationship("User", foreign_keys=[deactivated_by_id])


class Miller(Base, TimestampMixin):
    """Third-party miller — uses our facility / space and may store rice on our floor."""
    __tablename__ = "millers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(150))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    capacity_kg_per_hr: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    milling_fee_per_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    canva_color_hex: Mapped[str | None] = mapped_column(String(7))
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deactivated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    deactivated_by: Mapped["User | None"] = relationship("User", foreign_keys=[deactivated_by_id])
