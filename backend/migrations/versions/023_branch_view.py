"""Which branch the Boss's branch picker opens on.

The web app's top bar lets a Boss or Admin of a mill with more than one branch
look at one branch at a time, or at all of them together (core/branch_scope.py).
users.default_branch_view keeps where it opens: NULL for the main branch, "all",
or a branch id.

Revision ID: 023_branch_view
Revises: 022_account_closure
Create Date: 2026-10-24
"""

from __future__ import annotations

from alembic import op

revision = "023_branch_view"
down_revision = "022_account_closure"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built the table from the models.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_branch_view VARCHAR(36)")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS default_branch_view")
