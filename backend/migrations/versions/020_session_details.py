"""Keep each session's IP address and full User-Agent for the Devices list.

auth_sessions only had a short label ("Chrome · Windows"). Settings > Devices
now shows the kind of device, its name, the browser and OS, and the IP each
session signed in from and was last used from. Rows from before this have
neither; the page says so.

Revision ID: 020_session_details
Revises: 019_plan_tiers
Create Date: 2026-10-24
"""

from __future__ import annotations

from alembic import op

revision = "020_session_details"
down_revision = "019_plan_tiers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)")
    op.execute("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent VARCHAR(512)")


def downgrade() -> None:
    op.execute("ALTER TABLE auth_sessions DROP COLUMN IF EXISTS user_agent")
    op.execute("ALTER TABLE auth_sessions DROP COLUMN IF EXISTS ip_address")
