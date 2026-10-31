"""Ratings of the app from Settings > Feedback, with why they were given.

app_feedback lives in public so BossAdmin reads every mill's in one place. A
mill's feedback goes with the mill. Plain SQL, as in 025, so a later column can't
break this migration.

Revision ID: 033_app_feedback
Revises: 032_stock_count_settings
Create Date: 2026-10-31
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "033_app_feedback"
down_revision = "032_stock_count_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built this from the models.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app_feedback (
            id UUID PRIMARY KEY,
            company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
            user_id UUID REFERENCES users (id) ON DELETE SET NULL,
            rating SMALLINT NOT NULL CONSTRAINT ck_app_feedback_rating CHECK (rating BETWEEN 1 AND 5),
            reasons JSONB NOT NULL,
            other_text VARCHAR(500),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_app_feedback_company_id ON app_feedback (company_id)")

    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    # DO blocks take no bind parameters; the regex above makes the name safe.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                GRANT SELECT, INSERT ON TABLE app_feedback TO "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app_feedback")
