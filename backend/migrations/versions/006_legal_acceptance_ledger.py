"""Acceptance ledger for the published legal agreements.

Lives in the public schema alongside users, not in a tenant schema: consent is
given by a person to us, and it must survive a tenant schema being dropped.

Revision ID: 006_legal_acceptance
Revises: 005_runtime_provisioning
Create Date: 2026-09-24
"""
from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.core.config import settings

revision = "006_legal_acceptance"
down_revision = "005_runtime_provisioning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The baseline migration builds from current ORM metadata on a fresh
    # database, so guard for the table already existing (matches 005).
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "legal_acceptances" in inspector.get_table_names():
        return

    op.create_table(
        "legal_acceptances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("agreement_version", sa.String(32), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("documents", postgresql.JSONB, nullable=False),
        sa.Column("method", sa.String(20), nullable=False, server_default="signup"),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text, nullable=True),
        sa.Column(
            "accepted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_legal_acceptances_user", "legal_acceptances", ["user_id", "accepted_at"])
    op.create_index(
        "ix_legal_acceptances_company", "legal_acceptances", ["company_id", "accepted_at"]
    )
    op.create_index("ix_legal_acceptances_version", "legal_acceptances", ["agreement_version"])

    # Append-only by design. db_least_privilege.sql grants the runtime role
    # blanket SELECT/INSERT/UPDATE/DELETE on public (including future tables);
    # here we take back the two that matter, so a compromised application
    # credential cannot rewrite the evidence of who agreed to what. Amendments
    # and withdrawals are new rows, never edits.
    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    # DO blocks take no bind parameters, so the role name is interpolated. The
    # regex above is what makes that safe, and it matches the validator in
    # core/config.py.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                REVOKE UPDATE, DELETE ON TABLE legal_acceptances FROM "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_legal_acceptances_version", table_name="legal_acceptances")
    op.drop_index("ix_legal_acceptances_company", table_name="legal_acceptances")
    op.drop_index("ix_legal_acceptances_user", table_name="legal_acceptances")
    op.drop_table("legal_acceptances")
