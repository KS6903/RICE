"""User-scoped saved weather locations.

Each user can pin multiple cities and mark one as the default — the default
loads automatically on every login so the same weather follows them around.
The label is stored as plain text only; we never render upstream HTML.
"""
import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import TimestampMixin


class UserLocation(Base, TimestampMixin):
    __tablename__ = "user_locations"
    __table_args__ = (
        # Stops the same label being saved twice per user.
        UniqueConstraint("user_id", "label", name="ux_user_locations_user_label"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)         # "Manila, Philippines"
    lat: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    lon: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    country: Mapped[str | None] = mapped_column(String(80))
    region: Mapped[str | None] = mapped_column(String(120))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
