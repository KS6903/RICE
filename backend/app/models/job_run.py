import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import now_utc


class JobRun(Base):
    """One scheduled-job run: the claim that makes each run happen at most once.

    A job is due once per run key (a tenant-local date for daily jobs, a UTC
    hour for hourly ones). The unique index on (job, company_id, run_key)
    turns a second attempt at the same run into a no-op, whichever runner
    instance tries it. NULLS NOT DISTINCT makes platform-wide runs, which have
    no company, unique too. Lives in public: it spans tenants.
    """

    __tablename__ = "job_runs"
    __table_args__ = (
        Index(
            "uq_job_runs_job_company_run_key",
            "job",
            "company_id",
            "run_key",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job: Mapped[str] = mapped_column(String(64), nullable=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=True
    )
    run_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # running -> succeeded | failed. A failed run, or one stuck in running, is
    # claimed again on a later tick until it has used its attempts.
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=now_utc)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detail: Mapped[str | None] = mapped_column(Text)
