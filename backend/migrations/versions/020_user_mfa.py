"""020 — TOTP MFA columns on users

mfa_secret holds the Fernet-encrypted TOTP seed (NULL = not enrolled; non-NULL
with mfa_enabled=false = enrollment pending code verification). When
mfa_enabled is true, login becomes two-step: password → TOTP challenge.
"""
from alembic import op
import sqlalchemy as sa

revision = "020_user_mfa"
down_revision = "019_auth_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_secret", sa.String(255), nullable=True))
    op.add_column(
        "users",
        sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "mfa_enabled")
    op.drop_column("users", "mfa_secret")
