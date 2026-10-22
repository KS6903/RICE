"""The client a milling batch is for (custom milling).

Adds ``milling_batches.customer_id``, the customer whose palay went through the
mill. Empty for the mill's own palay, which is every batch so far. Plain SQL,
as in 018.

Revision ID: 019_milling_client
Revises: 018_annual_discount
Create Date: 2026-10-22
"""

from __future__ import annotations

from alembic import op

revision = "019_milling_client"
down_revision = "018_annual_discount"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 builds the table from today's
    # model, which already has the column.
    op.execute("ALTER TABLE milling_batches ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id)")


def downgrade() -> None:
    op.execute("ALTER TABLE milling_batches DROP COLUMN IF EXISTS customer_id")
