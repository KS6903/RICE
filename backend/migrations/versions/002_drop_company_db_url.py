"""Drop companies.db_url — back out database-per-client routing.

RICE briefly supported promoting a client to its own physical Postgres database
via ``companies.db_url`` (live engine routing). That escalation was reverted in
favour of staying on the shared database with schema-per-client isolation, so the
column is no longer read or written anywhere.

``db_url`` was never created by the baseline migration (001) — it only ever
existed on databases built straight from the ORM models — so the drop is guarded
with ``IF EXISTS`` to work on both ORM-built/live databases and fresh ones.

Revision ID: 002_drop_company_db_url
Revises: 001_public_baseline
Create Date: 2026-06-16
"""
from __future__ import annotations

from alembic import op

revision = "002_drop_company_db_url"
down_revision = "001_public_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE companies DROP COLUMN IF EXISTS db_url')


def downgrade() -> None:
    op.execute('ALTER TABLE companies ADD COLUMN IF NOT EXISTS db_url text')
