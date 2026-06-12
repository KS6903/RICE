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
-- Alembic migrations keep running under the owning role (or postgres), NOT
-- ricemill_app — run `alembic upgrade head` with the admin URL at deploy time.

\set ON_ERROR_STOP on

-- 1. Dedicated login role for the API process.
CREATE ROLE ricemill_app LOGIN PASSWORD :'app_password';

-- 2. Connect + schema usage only (no CREATE on the schema).
GRANT CONNECT ON DATABASE :"DBNAME" TO ricemill_app;
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

-- Optional next layer (not enabled here): PostgreSQL row-level security keyed
-- on company_id would enforce tenant isolation in the database itself, behind
-- the app's get_for_company() checks. It requires a per-request
-- `SET app.company_id = ...` and policies on every tenant table — adopt it as a
-- follow-up once the app role above is in place.
