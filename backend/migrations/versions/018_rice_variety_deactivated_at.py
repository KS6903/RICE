"""018 — add deactivated_at to rice_varieties

Tracks when a variety was deactivated so the background cleanup job can
delete it after 30 days. System/shared varieties (company_id IS NULL) are
never touched by the cleanup job.
"""
from alembic import op
import sqlalchemy as sa

revision = "018_rice_variety_deactivated_at"
down_revision = "017_remove_p20_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rice_varieties",
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rice_varieties", "deactivated_at")
