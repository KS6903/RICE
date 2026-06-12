import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import now_utc


class AuthSession(Base):
    """One refresh-token session (a row per issued refresh token).

    The row id IS the refresh token's ``jti`` claim, so presenting a refresh
    token maps 1:1 to a session row. Rotation: each /refresh revokes this row
    (stamping ``replaced_by``) and inserts a successor in the same ``family_id``.
    Reuse of a revoked token is theft evidence — the whole family is revoked.
    """

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Chain id: stable across rotations within one login. Indexed for family revocation.
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Successor session id when rotated (None for revocations from logout/password change).
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # Coarse client info for the user's "active sessions" view / audit. Optional.
    client: Mapped[str | None] = mapped_column(String(255))
