import uuid

from sqlalchemy import CheckConstraint, ForeignKey, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import TimestampMixin


class AppFeedback(Base, TimestampMixin):
    """A rating of the app from Settings > Feedback, with why it was given. In
    public, so BossAdmin reads every mill's in one place."""

    __tablename__ = "app_feedback"
    __table_args__ = (CheckConstraint("rating BETWEEN 1 AND 5", name="ck_app_feedback_rating"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # Codes from api/feedback.py, and "other" when other_text says why.
    reasons: Mapped[list] = mapped_column(JSONB, nullable=False)
    other_text: Mapped[str | None] = mapped_column(String(500))
