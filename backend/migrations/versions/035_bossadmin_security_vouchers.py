"""BossAdmin hardening, "View as", vouchers and page release stages.

- users: admin_confirmed_until / admin_confirmed_sid, the window a BossAdmin
  password + authenticator confirmation opens for making changes, bound to the
  one sign-in that confirmed.
- admin_audit_log: every change BossAdmin makes and every "View as" visit.
  Append-only for the app's role: UPDATE and DELETE are revoked.
- vouchers, voucher_redemptions: codes BossAdmin gives out; one use per mill,
  held by a unique constraint. plan_payments and subscription_upgrade_requests
  record the voucher and what it took off.
- page_releases and companies.page_overrides: how far each page is released
  (BossAdmin only, Enterprise, Pro, Basic, everyone), and per-mill switches.

Plain SQL with IF NOT EXISTS, as in 025: on a fresh database 001 already built
all of this from the models.

Revision ID: 035_bossadmin_security_vouchers
Revises: 034_pro_notifications
Create Date: 2026-11-07
"""

from __future__ import annotations

import re

from alembic import op

from app.core.config import settings

revision = "035_bossadmin_security_vouchers"
down_revision = "034_pro_notifications"
branch_labels = None
depends_on = None


def _role() -> str:
    role = settings.RUNTIME_DATABASE_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError(f"Unsafe RUNTIME_DATABASE_ROLE: {role!r}")
    return role


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_confirmed_until TIMESTAMPTZ")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_confirmed_sid UUID")
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS page_overrides JSONB")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id UUID PRIMARY KEY,
            admin_id UUID,
            admin_username VARCHAR(50) NOT NULL,
            action VARCHAR(50) NOT NULL,
            method VARCHAR(10),
            path VARCHAR(300),
            company_id UUID,
            detail TEXT,
            ip_address VARCHAR(45),
            user_agent VARCHAR(512),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_admin_audit_log_company_id ON admin_audit_log (company_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_admin_audit_log_admin_id ON admin_audit_log (admin_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_admin_audit_log_created_at ON admin_audit_log (created_at)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS page_releases (
            section VARCHAR(40) PRIMARY KEY,
            stage VARCHAR(20) NOT NULL,
            updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS vouchers (
            id UUID PRIMARY KEY,
            code VARCHAR(40) NOT NULL UNIQUE,
            kind VARCHAR(20) NOT NULL
                CONSTRAINT ck_vouchers_kind CHECK (kind IN ('free_time', 'percent_off', 'amount_off')),
            plan_id UUID REFERENCES subscription_plans (id),
            billing_interval VARCHAR(10),
            percent_off NUMERIC(5, 2)
                CONSTRAINT ck_vouchers_pct CHECK (percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
            amount_off NUMERIC(10, 2) CONSTRAINT ck_vouchers_amount CHECK (amount_off IS NULL OR amount_off > 0),
            amount_off_usd NUMERIC(10, 2)
                CONSTRAINT ck_vouchers_amount_usd CHECK (amount_off_usd IS NULL OR amount_off_usd > 0),
            free_months INTEGER NOT NULL DEFAULT 0,
            free_days INTEGER NOT NULL DEFAULT 0,
            company_id UUID REFERENCES companies (id) ON DELETE CASCADE,
            max_uses INTEGER CONSTRAINT ck_vouchers_max_uses CHECK (max_uses IS NULL OR max_uses > 0),
            starts_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            is_active BOOLEAN NOT NULL DEFAULT true,
            note VARCHAR(300),
            created_by UUID REFERENCES users (id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_vouchers_free_time CHECK (free_months >= 0 AND free_days >= 0)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_vouchers_company_id ON vouchers (company_id)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS voucher_redemptions (
            id UUID PRIMARY KEY,
            voucher_id UUID NOT NULL REFERENCES vouchers (id) ON DELETE CASCADE,
            company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
            company_name VARCHAR(200) NOT NULL DEFAULT '',
            user_id UUID REFERENCES users (id) ON DELETE SET NULL,
            plan_id UUID REFERENCES subscription_plans (id),
            currency VARCHAR(3),
            discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
            plan_payment_id UUID REFERENCES plan_payments (id),
            upgrade_request_id UUID REFERENCES subscription_upgrade_requests (id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_voucher_redemptions_once UNIQUE (voucher_id, company_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_voucher_redemptions_voucher_id ON voucher_redemptions (voucher_id)")

    op.execute("ALTER TABLE plan_payments ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES vouchers (id)")
    op.execute("ALTER TABLE plan_payments ADD COLUMN IF NOT EXISTS discount NUMERIC(10, 2) NOT NULL DEFAULT 0")
    op.execute(
        "ALTER TABLE subscription_upgrade_requests ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES vouchers (id)"
    )
    op.execute(
        "ALTER TABLE subscription_upgrade_requests ADD COLUMN IF NOT EXISTS discount NUMERIC(10, 2) NOT NULL DEFAULT 0"
    )
    op.execute("ALTER TABLE subscription_upgrade_requests ADD COLUMN IF NOT EXISTS amount_due NUMERIC(10, 2)")

    role = _role()
    # DO blocks take no bind parameters; _role() makes the name safe. The audit
    # log is append-only: the default privileges granted UPDATE and DELETE on
    # every new public table, so they are taken back here.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                GRANT SELECT, INSERT ON TABLE admin_audit_log TO "{role}";
                REVOKE UPDATE, DELETE, TRUNCATE ON TABLE admin_audit_log FROM "{role}";
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE page_releases TO "{role}";
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE vouchers TO "{role}";
                GRANT SELECT, INSERT ON TABLE voucher_redemptions TO "{role}";
                REVOKE UPDATE, DELETE ON TABLE voucher_redemptions FROM "{role}";
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE subscription_upgrade_requests DROP COLUMN IF EXISTS amount_due")
    op.execute("ALTER TABLE subscription_upgrade_requests DROP COLUMN IF EXISTS discount")
    op.execute("ALTER TABLE subscription_upgrade_requests DROP COLUMN IF EXISTS voucher_id")
    op.execute("ALTER TABLE plan_payments DROP COLUMN IF EXISTS discount")
    op.execute("ALTER TABLE plan_payments DROP COLUMN IF EXISTS voucher_id")
    op.execute("DROP TABLE IF EXISTS voucher_redemptions")
    op.execute("DROP TABLE IF EXISTS vouchers")
    op.execute("DROP TABLE IF EXISTS page_releases")
    op.execute("DROP TABLE IF EXISTS admin_audit_log")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS page_overrides")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS admin_confirmed_sid")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS admin_confirmed_until")
