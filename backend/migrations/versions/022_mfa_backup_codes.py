"""022 — MFA backup/recovery codes

Single-use recovery codes for when a user can't reach their authenticator.
Stored as a JSON array of SHA-256 hashes of the still-unused codes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "022_mfa_backup_codes"
down_revision = "021_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_backup_codes", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "mfa_backup_codes")
