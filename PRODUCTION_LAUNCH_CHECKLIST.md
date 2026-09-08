# Production launch checklist

Companion to [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md). Every item below runs
**outside** the development repo session — on your admin workstation, the production
database, the hosting provider, GitHub settings, ops tooling, or each desktop device.
Work top to bottom: later phases depend on earlier ones.

Never commit an env file, generated secret, database dump, SQLite file, log, or
recovery artifact. Env var names below are the ones the fail-closed validator in
`backend/app/core/config.py` enforces when `ENV=prod` — the API refuses to boot if any
are missing or insecure. Booleans are lowercase `true`/`false`.

---

## Done for you (in this repo — uncommitted working tree)

- **Env templates** with every prod-required key, placeholders, and the two traps
  flagged: [backend/deploy/api.env.example](backend/deploy/api.env.example) and
  [backend/deploy/provisioner.env.example](backend/deploy/provisioner.env.example).
- **This checklist.** Nothing here was executed — none of the targets (prod DB,
  hosting, GitHub admin, devices) is reachable from the dev session.

---

## What only you can do — the residual list

The complete "your job" set, grouped by where it happens. Details + commands are in
the phases below.

**On your admin workstation** (`backend/.venv`)
- [ ] Generate secrets → move the 3 values to the secret manager → delete the file
      (Phase 0).
- [ ] Fill in both templates, validate each with `check_production_config.py`, upload
      values (Phase 2).
- [ ] Run migrations with the provisioner credential (Phase 3).

**As a PostgreSQL admin**
- [ ] Create a runtime (DML) role and a separate provisioner (owner/DDL) role; apply
      `db_least_privilege.sql`; verify with `verify_runtime_role.sql` (Phases 1, 4).

**On the hosting provider**
- [ ] Deploy API and worker as separate identities (only the worker gets
      `PROVISIONER_DATABASE_URL`); run the watcher with alerting (Phase 5).
- [ ] TLS/proxy, real domains, secure cookie domain, HSTS + cert-renewal alerts;
      managed TLS Postgres + Redis; encrypted backups + tested restore; SMTP + OAuth
      (Phase 6).

**As a GitHub repo admin**
- [ ] Protect `main`, require CI security jobs, restrict force-push, enable secret
      scanning + Dependabot (Phase 8).

**In ops/monitoring**
- [ ] Forward audit/security logs to a restricted SIEM and define the alerts (Phase 9).

**On each desktop**
- [ ] BitLocker on every device holding offline SQLite; escrow recovery keys (Phase 7).

**Team-coordinated / destructive**
- [ ] Rewrite git history only if a secret/log was ever committed; independent pen test
      (Phase 10).

---

## Supervision legend

Each phase is tagged with how much human involvement it genuinely needs:

- **A — Human authority required.** A decision, a credential only you hold, a device,
  or a destructive act. Never fully unattended.
- **B — Automated execution, human gate/on-call.** Runs by script, but needs an
  approval click or someone to answer the alert.
- **C — Fully scriptable, no supervision.** Should become a CI/CD gate so a machine
  enforces it on every deploy.

---

## Phase 0 — Secrets  ·  Runs `[WORKSTATION]` -> `[HOSTING]`  ·  Supervision **A** (custody) + **C** (generation)

- [ ] Generate the one-time secret file:
  ```powershell
  cd backend
  .\.venv\Scripts\python.exe generate_security_secrets.py
  ```
  Creates `.env.production.secrets` (mode 600, refuses to overwrite) containing
  `SECRET_KEY`, `MFA_ENCRYPTION_KEY`, and `SIGNUP_INVITE_CODE`.
- [ ] Paste those three values into the hosting provider's secret manager.
- [ ] Securely delete the local file:
  ```powershell
  Remove-Item backend\.env.production.secrets -Force
  ```
- [ ] Confirm `.env*` is gitignored and nothing secret is staged (`git status`).

## Phase 1 — Database roles  ·  Runs `[PROD DB]`  ·  Supervision **A**

- [ ] Create/rotate the **runtime (API) role** — data-only, and apply its grants:
  ```powershell
  psql -d <database> -v app_password='<random-secret>' -f backend/scripts/db_least_privilege.sql
  ```
- [ ] Create a **separate provisioner/owner role** that owns objects and can run DDL
  (migrations + tenant schema creation). It must be a *different* role from the runtime role.
- [ ] Ensure the runtime role name is safe and non-administrative (not `postgres`,
  not `rds_superuser`) — this becomes `RUNTIME_DATABASE_ROLE`.

## Phase 2 — Two deployment configs  ·  Runs `[HOSTING]`, validate on `[WORKSTATION]`  ·  Supervision **A** (real values) + **C** (validation)

Start from the templates — they already list every required key:
[backend/deploy/api.env.example](backend/deploy/api.env.example) and
[backend/deploy/provisioner.env.example](backend/deploy/provisioner.env.example).

- [ ] Copy each template to a non-committed candidate file and replace every
  `__PLACEHOLDER__` / `example.com` value with the real thing.
- [ ] Key differences already baked into the templates (do not undo them):
  - **API** (`PROCESS_ROLE=api`): runtime DML-only `DATABASE_URL` with `sslmode=require`,
    and **no** `PROVISIONER_DATABASE_URL` at all.
  - **Provisioner** (`PROCESS_ROLE=provisioner`): same runtime `DATABASE_URL` **plus**
    `PROVISIONER_DATABASE_URL` using a *different* role, TLS required.
- [ ] Validate BOTH before uploading (expect "passed all fail-closed checks"):
  ```powershell
  cd backend
  .\.venv\Scripts\python.exe check_production_config.py deploy\api.env
  .\.venv\Scripts\python.exe check_production_config.py deploy\provisioner.env
  ```
- [ ] Move the values into the secret manager and delete the candidate files.

## Phase 3 — Migrations  ·  Runs `[WORKSTATION]` / CI, using ONLY the provisioner config  ·  Supervision **B**

- [ ] As the DB owner (provisioner credential):
  ```powershell
  .\.venv\Scripts\python.exe -m alembic upgrade head
  .\.venv\Scripts\python.exe migrate_all_tenants.py
  ```

## Phase 4 — Verify runtime least-privilege  ·  Runs `[PROD DB]`  ·  Supervision **C**

- [ ] Start the API with **only** the runtime credential, then verify independently:
  ```powershell
  psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/verify_runtime_role.sql
  ```

## Phase 5 — Provisioning worker  ·  Runs `[HOSTING]` (separate identity)  ·  Supervision **B**

- [ ] Run it in its own container/service identity — the only place `PROVISIONER_DATABASE_URL` lives:
  ```powershell
  .\.venv\Scripts\python.exe provision_pending_tenants.py --watch
  ```
- [ ] Alert on worker failure and on any non-null `companies.provisioning_error`.

## Phase 6 — External services  ·  Runs `[OPS]`  ·  Supervision **A** (setup) + **B** (renewals)

- [ ] Terminate TLS at a maintained reverse proxy / load balancer; HSTS monitoring + cert-renewal alerts.
- [ ] Managed TLS PostgreSQL + Redis (`rediss://`); network allowlists; separate service identities.
- [ ] Encrypted database backups + tested restore into an **isolated** database; document the recovery procedure.
- [ ] Configure SMTP and Google OAuth production origins/redirects; rotate any credential ever shared, logged, or committed.

## Phase 7 — Desktop devices  ·  Runs `[DEVICES]`  ·  Supervision **A**

- [ ] Enable BitLocker on every device storing offline SQLite; confirm with `manage-bde -status`.
- [ ] Store recovery keys in a secure organization account.
- [ ] Deferred: SQLCipher app-level encryption stays out until `better-sqlite3` is swapped for a
  SQLCipher-capable build. BitLocker is the interim control.

## Phase 8 — GitHub hardening  ·  Runs `[GITHUB]`  ·  Supervision **A**

- [ ] Protect `main`: require PR review, require the CI security jobs to pass, restrict who can force-push.
      Security jobs: pytest, type checking, dependency audit, Bandit, gitleaks, npm audit, CodeQL.
- [ ] Enable secret scanning + push protection.
- [ ] Enable Dependabot alerts.

## Phase 9 — Monitoring  ·  Runs `[OPS]`  ·  Supervision **A** (define alerts) + **B** (on-call)

- [ ] Forward structured security/audit logs to a restricted SIEM; define retention.
- [ ] Alert on: login lockouts, MFA recovery, provisioning failures, repeated 401/403/429 responses,
      and unexpected process/database roles.

## Phase 10 — History + pen test  ·  Runs `[TEAM]`  ·  Supervision **A** (mandatory human)

- [ ] If any secret or sensitive log (e.g. an old `backend.log`) ever existed in history: rewrite
      history, force-push with team coordination, invalidate old clones, and rotate affected credentials.
      `.gitignore` prevents recurrence but does not erase history — this is destructive; do it deliberately.
- [ ] Arrange an independent penetration test before launch and after major auth / tenant-isolation changes.

---

### Reference (already automated, listed for completeness)

- Account recovery: `recover_mfa.py <username> --operator <id> --ticket <id>` (typed confirmation,
  clears MFA, revokes sessions, writes an audit event) — run only after identity verification.
- Disposable API E2E: set `E2E_DATABASE_URL` (name must contain `e2e`) then `npm run test:e2e:api`.
- Exact command context lives in [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md).
