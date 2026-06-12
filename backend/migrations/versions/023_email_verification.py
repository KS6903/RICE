"""023 — email verification

Adds email_verified plus a hashed, expiring verification token on users.
Existing accounts predate the feature, so they're grandfathered as verified.
"""
from alembic import op
import sqlalchemy as sa

revision = "023_email_verification"
down_revision = "022_mfa_backup_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column("users", sa.Column("email_verification_hash", sa.String(64), nullable=True))
    op.add_column(
        "users", sa.Column("email_verification_expires", sa.DateTime(timezone=True), nullable=True)
    )
    # Grandfather everyone who signed up before this feature existed.
    op.execute("UPDATE users SET email_verified = true")


def downgrade() -> None:
    op.drop_column("users", "email_verification_expires")
    op.drop_column("users", "email_verification_hash")
    op.drop_column("users", "email_verified")
