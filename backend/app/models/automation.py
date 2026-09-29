import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import TimestampMixin


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
