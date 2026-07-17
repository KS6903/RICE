-- Exit non-zero unless the connected API role is genuinely least-privileged.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_runtime_role.sql
\set ON_ERROR_STOP on

DO $verify$
DECLARE
  unsafe boolean;
BEGIN
  IF current_user <> 'ricemill_app' THEN
    RAISE EXCEPTION 'Unexpected runtime role: %', current_user;
  END IF;

  SELECT (
    r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
    OR has_database_privilege(current_user, current_database(), 'CREATE')
    OR has_schema_privilege(current_user, 'public', 'CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_namespace n
      WHERE n.nspname ~ '^client_[a-f0-9]{32}$'
        AND has_schema_privilege(current_user, n.oid, 'CREATE')
    )
    OR EXISTS (
      SELECT 1 FROM pg_namespace n
      WHERE (n.nspname = 'public' OR n.nspname ~ '^client_[a-f0-9]{32}$')
        AND n.nspowner = r.oid
    )
    OR EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE (n.nspname = 'public' OR n.nspname ~ '^client_[a-f0-9]{32}$')
        AND c.relowner = r.oid
    )
  ) INTO unsafe
  FROM pg_roles r WHERE r.rolname = current_user;

  IF unsafe THEN
    RAISE EXCEPTION 'Runtime role has forbidden admin, ownership, or CREATE privileges';
  END IF;
END
$verify$;

SELECT current_user AS verified_runtime_role;
