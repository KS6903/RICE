import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, SmallInteger, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import TimestampMixin, now_utc


class AutomationRule(Base, TimestampMixin):
    """A tenant's settings for one automation recipe (Enterprise only).

    One row per recipe per tenant: whether it's switched on, its 1–3 settings,
    and who receives it. The recipe itself (what it computes, when it runs)
    lives in code, in app/automations. Each run is recorded in job_runs under
    the name "automation.<recipe>", which is also what keeps a run from
    happening twice.
    """

    __tablename__ = "automation_rules"
    __table_args__ = (UniqueConstraint("company_id", "recipe", name="uq_automation_rules_company_recipe"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    recipe: Mapped[str] = mapped_column(String(40), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # User ids (as strings). Re-checked at send time: someone who has since left
    # or lost access to the recipe's section silently drops off.
    recipients: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    # Track each alert as a task (ActionItem) until someone resolves it: given
    # to track_assignee (or, when that person can't receive it, left for a
    # manager to assign), due track_due_hours after it's raised.
    track: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    track_assignee: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    track_due_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=24, server_default="24")


class AutomationState(Base):
    """A condition a recipe has already reported, so it isn't reported again
    until it clears: rice that is still low on stock tomorrow is old news.

    One row per (recipe, key) while the condition holds. The recipe deletes the
    row when the condition clears, which re-arms it.
    """

    __tablename__ = "automation_state"
    __table_args__ = (UniqueConstraint("recipe", "key", name="uq_automation_state_recipe_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    recipe: Mapped[str] = mapped_column(String(40), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    since: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=now_utc)


class AutomationSettings(Base, TimestampMixin):
    """The tenant's choices that apply to every automation; one row.

    AI recipes send the mill's records, names included, to DeepSeek outside the
    Philippines. That needs the owner's own decision, so ai_enabled starts off,
    only an owner can switch it on, and who did and when is kept. Switching it
    off stops every AI recipe at once without touching their settings.
    """

    __tablename__ = "automation_settings"
    __table_args__ = (UniqueConstraint("company_id", name="uq_automation_settings_company"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    ai_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
    # The owner who last switched AI on or off, and when.
    ai_changed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    ai_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
