-- Database least-privilege setup (security hardening P2.14).
--
-- The app currently connects as the `postgres` superuser in dev. In production
-- the API must run as a dedicated role that can read/write data but can NOT
-- create/drop/alter schema objects — so SQL injection or app compromise can't
-- escalate to schema changes, extension installs, or file reads.
--
-- Usage (run as a superuser, against the app database):
--   psql -d "Rice Mill System" -v app_password='<strong-random-password>' -f db_least_privilege.sql
--
-- Then point DATABASE_URL at ricemill_app:
--   DATABASE_URL=postgresql://ricemill_app:<password>@host:5432/Rice Mill System
--
-- Alembic and provision_pending_tenants.py run in a separate process with the
-- owning/provisioner role. Never expose that credential to the API container.

\set ON_ERROR_STOP on

-- 1. Dedicated login role for the API process (idempotent; also rotates its password).
SELECT format('CREATE ROLE ricemill_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ricemill_app') \gexec
ALTER ROLE ricemill_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'app_password';

-- 2. Connect + schema usage only (no CREATE on the schema).
GRANT CONNECT ON DATABASE :"DBNAME" TO ricemill_app;
REVOKE CREATE ON DATABASE :"DBNAME" FROM ricemill_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ricemill_app;
REVOKE CREATE ON SCHEMA public FROM ricemill_app;

-- 3. Data access on existing tables/sequences (no TRUNCATE, no DDL).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ricemill_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ricemill_app;

-- 4. Future tables created by migrations get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ricemill_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ricemill_app;

-- 4b. The legal acceptance ledger is append-only: consent evidence is added,
-- never rewritten or deleted. Step 3 just granted UPDATE/DELETE on every public
-- table, so take those two back here, where re-running this script (to rotate
-- the password, say) can't silently hand them back. Before the first migration
-- the table doesn't exist yet; migration 007 revokes them once it does.
DO $ledger$
BEGIN
  IF to_regclass('public.legal_acceptances') IS NOT NULL THEN
    REVOKE UPDATE, DELETE ON TABLE public.legal_acceptances FROM ricemill_app;
  END IF;
END
$ledger$;

-- 5. Existing tenant schemas. New schemas receive the equivalent grants from
-- core/tenancy.py while connected with PROVISIONER_DATABASE_URL.
DO $grants$
DECLARE
  tenant_schema text;
BEGIN
  FOR tenant_schema IN
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name ~ '^client_[a-f0-9]{32}$'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO ricemill_app', tenant_schema);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO ricemill_app',
      tenant_schema
    );
    EXECUTE format(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO ricemill_app',
      tenant_schema
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ricemill_app',
      tenant_schema
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO ricemill_app',
      tenant_schema
    );
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM ricemill_app', tenant_schema);
  END LOOP;
END
$grants$;

-- The migration/provisioning role owns schemas and tables. Configure its URL
-- only in the deployment job; the long-running API process never receives it.

-- Optional next layer (not enabled here): PostgreSQL row-level security keyed
-- on company_id would enforce tenant isolation in the database itself, behind
-- the app's get_for_company() checks. It requires a per-request
-- `SET app.company_id = ...` and policies on every tenant table — adopt it as a
-- follow-up once the app role above is in place.
