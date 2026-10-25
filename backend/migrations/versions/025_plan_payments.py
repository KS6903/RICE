"""Online payments for plans, and a price in US dollars for each plan.

plan_payments holds one row per PayMongo checkout (pesos) or PayPal order (US
dollars) a mill starts; paid, it moves the mill onto the plan by itself
(services/payment_service.py). It lives in public: the provider's webhook
arrives with no mill attached, and a payment stays on the books after its mill
is deleted (company_id is then NULL; company_name keeps who it was).

subscription_plans gains monthly_price_usd and annual_price_usd, the price
PayPal charges. 0 means the plan isn't offered in dollars. Plain SQL, as in
021, so a later column can't break this migration.

Revision ID: 025_plan_payments
Revises: 024_plan_payment_account
Create Date: 2026-10-25
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "025_plan_payments"
down_revision = "024_plan_payment_account"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 001 already built these from the models.
    op.execute(
        "ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS monthly_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS annual_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS plan_payments (
            id UUID PRIMARY KEY,
            company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
            company_name VARCHAR(200) NOT NULL,
            plan_id UUID NOT NULL REFERENCES subscription_plans (id),
            plan_name VARCHAR(100) NOT NULL,
            billing_interval VARCHAR(10) NOT NULL,
            provider VARCHAR(20) NOT NULL,
            currency VARCHAR(3) NOT NULL,
            amount NUMERIC(10, 2) NOT NULL,
            status VARCHAR(20) NOT NULL,
            provider_ref VARCHAR(100),
            provider_payment_id VARCHAR(100),
            checkout_url VARCHAR(1000),
            paid_at TIMESTAMPTZ,
            created_by UUID REFERENCES users (id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_plan_payments_company_id ON plan_payments (company_id)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_payments_provider_ref ON plan_payments (provider, provider_ref)"
    )

    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    # DO blocks take no bind parameters; the regex above makes the name safe.
    # No DELETE: a payment record is kept.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                GRANT SELECT, INSERT, UPDATE ON TABLE plan_payments TO "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS plan_payments")
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS annual_price_usd")
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS monthly_price_usd")
