# Security operations runbook

This runbook covers the deployment actions that cannot be safely automated from
the repository. Never commit an environment file, generated secret, database
dump, SQLite file, log, or recovery artifact.

## Production release gate

1. Generate the app's own secrets straight into the Worker's secret store:

   ```powershell
   cd backend
   .\.venv\Scripts\python.exe generate_security_secrets.py
   ```

   No value is printed or written to disk, and a secret the Worker already has is
   left alone. `--only SIGNUP_INVITE_CODE` rotates one; `MFA_ENCRYPTION_KEY` is
   never rotated, because it decrypts every user's two-factor seed and every
   mill's backup file (`.oraiza`). For another
   host, `--output FILE` writes a new mode-600 file; move the values into that
   secret manager and delete the file.

2. Create two deployment configurations:

   - API: `PROCESS_ROLE=api`, a DML-only `DATABASE_URL`, and no
     `PROVISIONER_DATABASE_URL` variable at all.
   - Provisioner: `PROCESS_ROLE=provisioner`, the same runtime `DATABASE_URL`,
     plus a short-lived `PROVISIONER_DATABASE_URL` whose role owns the database
     objects needed for migrations and tenant schema creation.

3. Validate both files before uploading their values:

   ```powershell
   .\.venv\Scripts\python.exe check_production_config.py <api-env-file>
   .\.venv\Scripts\python.exe check_production_config.py <provisioner-env-file>
   ```

4. As the database owner, apply migrations and tenant-table updates using only
   the provisioner configuration:

   ```powershell
   .\.venv\Scripts\python.exe -m alembic upgrade head
   .\.venv\Scripts\python.exe migrate_all_tenants.py
   ```

5. As a PostgreSQL administrator, create/rotate the runtime credential and grant
   its data-only privileges:

   ```powershell
   psql -d <database> -v app_password='<random-secret>' -f scripts/db_least_privilege.sql
   ```

   Start the API with only the runtime credential, then verify it independently:

   ```powershell
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_runtime_role.sql
   ```

6. Run the isolated tenant worker with only the provisioner secret scope:

   ```powershell
   .\.venv\Scripts\python.exe provision_pending_tenants.py --watch
   ```

   Keep it in a separate container/service identity from the API. Alert on worker
   failures and on non-null `companies.provisioning_error` values.

7. Install from immutable dependency inputs and run the release checks:

   ```powershell
   python -m pip install --require-hashes -r backend/requirements-dev.txt
   npm ci
   ```

   CI blocks on pytest, type checking, dependency audits, Bandit, gitleaks, npm
   audit, and CodeQL. GitHub Actions are pinned to full commit hashes.

## Disposable E2E tests (API and browser)

Never point Playwright at a development or production database. The launcher
refuses any target whose database name does not contain `e2e`, drops/recreates
that target, migrates it, seeds fixed test accounts (on the Enterprise plan),
and then starts the API on :8001.

```powershell
$env:E2E_DATABASE_URL='postgresql://postgres:<password>@127.0.0.1:5432/ricemill_e2e'
npm run test:e2e:api   # request-level suite
npm run test:e2e       # browser suite: also starts a web dev server on :8449
```

The browser suite needs Playwright's Chromium once (`npx playwright install chromium`).
It runs beside the everyday :8448/:8000 stack without touching it. Run the two
suites one after the other: both use :8001.

## Account recovery

Complete the organization's identity-verification procedure and obtain an
approved ticket before resetting MFA. Run from a trusted backend host:

```powershell
.\.venv\Scripts\python.exe recover_mfa.py <exact-username> `
  --operator <operator-id> --ticket <ticket-id>
```

The command requires typed confirmation, clears MFA, revokes every session, and
writes an audit event. Require the user to change their password if compromise
is suspected and re-enroll MFA immediately.

## External controls still required

- Terminate TLS at a maintained reverse proxy/load balancer; set real HTTPS
  origins, trusted hosts, secure cookie domain, HSTS monitoring, and certificate
  renewal alerts.
- Use managed TLS PostgreSQL and Redis services, encrypted backups, tested restore
  procedures, network allowlists, and separate service identities.
- Configure SMTP and Google OAuth production origins/redirects; rotate any real
  credentials that were ever shared, logged, or committed.
- Enable full-disk encryption (BitLocker/FileVault/LUKS) on every desktop that
  stores offline SQLite data. The app partitions tenant files and migrates a
  validated legacy database, but OS-level encryption and device recovery policy
  are deployment controls.
- Forward structured security/audit logs to a restricted SIEM, define retention,
  and alert on login lockouts, MFA recovery, provisioning failures, repeated 401/
  403/429 responses, and unexpected process/database roles.
- Rewrite Git history if secrets or sensitive logs existed in prior commits, then
  force-push with team coordination, invalidate old clones, and rotate affected
  credentials. Current `.gitignore` rules prevent recurrence but do not erase
  history.
- Protect the main branch, require the CI security jobs, enable repository secret
  scanning/dependency alerts, and schedule an independent penetration test before
  production launch and after major authentication/tenant-isolation changes.
