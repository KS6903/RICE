"""Acceptance ledger for the published agreements.

This table exists for one reason: so that "they never agreed to those terms"
is an answerable question. Each row is the evidence of one click, and it
records not just *that* someone accepted but *what text was on screen*, via
the SHA-256 of each rendered document (``documents``) and of the bundle
(``content_hash``). Terms that cannot be tied to a specific accepted version
tend to be worth very little in a dispute.

Rows are append-only by convention: a withdrawal or a new version is a new
row, never an update of an old one, so the history stays intact.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import now_utc


class LegalAcceptance(Base):
    __tablename__ = "legal_acceptances"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Denormalised on purpose: which company the user acted for at the moment
    # of acceptance, even if they are later moved or the company is renamed.
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL")
    )
    # Version of the agreement bundle (core.legal.AGREEMENT_VERSION).
    agreement_version: Mapped[str] = mapped_column(String(32), nullable=False)
    # SHA-256 over every document in the bundle at the version accepted.
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Per-document key/version/effective_date/sha256, as shown to the user.
    documents: Mapped[list] = mapped_column(JSONB, nullable=False)
    # How consent was given: "signup", "gate" (re-acceptance on version bump),
    # or "invite" (an Authorised User added by an owner).
    method: Mapped[str] = mapped_column(String(20), nullable=False, default="signup")
    # Evidence of circumstance. Truncated, and never used for tracking.
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(Text)
    accepted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_legal_acceptances_user", "user_id", "accepted_at"),
        Index("ix_legal_acceptances_company", "company_id", "accepted_at"),
        Index("ix_legal_acceptances_version", "agreement_version"),
    )
