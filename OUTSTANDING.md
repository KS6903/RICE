# Outstanding work — phased roadmap

Ordered top to bottom as of 2026-07-19: do the phases in sequence. Deep detail
and exact commands for the production phases live in
[PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md); each phase below
notes which of its phases it maps to.

---

## Phase 1 — Land the idle-logout change  ·  repo, now

- [ ] Push commit `ad31808` (idle auto-logout) to `origin/feat/schema-per-client`.
- [ ] Commit the still-untracked docs:
      [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md),
      [backend/deploy/api.env.example](backend/deploy/api.env.example),
      [backend/deploy/provisioner.env.example](backend/deploy/provisioner.env.example),
      and this file.
- [ ] Verify the idle logout live in a real browser/Electron session (so far only
      unit tests + typecheck + lint have run).

## Phase 2 — Idle-logout enhancements  ·  optional (not requested)

- [ ] Make the window configurable (app settings / per-tenant) instead of the
      `IDLE_TIMEOUT_MS` constant in `packages/web/src/hooks/useIdleLogout.ts`.
- [ ] Add a "signing you out soon" warning + countdown before logout (today it is
      silent until the notice on `/login`).
- [ ] Decide whether server-side idle enforcement is wanted; client-side only
      today, backed by the 15-minute access-token expiry.

## Phase 3 — Secrets & database roles  ·  prod  ·  = launch checklist Phases 0–1

- [ ] Generate secrets → move to the secret manager → delete the local file.
- [ ] Create a runtime (DML) role and a separate provisioner (owner/DDL) role;
      apply `db_least_privilege.sql`.

## Phase 4 — Configs & migrations  ·  prod  ·  = Phases 2–3

- [ ] Fill in both deployment configs from the templates and validate each with
      `check_production_config.py`; upload values; delete the candidate files.
- [ ] Run `alembic upgrade head` + `migrate_all_tenants.py` with the provisioner
      credential.

## Phase 5 — Runtime verification & worker  ·  prod  ·  = Phases 4–5

- [ ] Run `verify_runtime_role.sql` against the runtime credential.
- [ ] Deploy `provision_pending_tenants.py --watch` as a separate service identity,
      with alerts on failure and on `companies.provisioning_error`.

## Phase 6 — External services  ·  prod/ops  ·  = Phase 6

- [ ] TLS/proxy, real domains, secure cookie domain, HSTS + cert-renewal alerts.
- [ ] Managed TLS PostgreSQL + Redis; encrypted backups + tested restore.
- [ ] SMTP credentials + Google OAuth production origins/redirects.

## Phase 7 — Device encryption  ·  devices  ·  = Phase 7

- [ ] BitLocker on every device storing offline SQLite; escrow recovery keys.

## Phase 8 — GitHub & monitoring hardening  ·  admin/ops  ·  = Phases 8–9

- [ ] Protect `main`, require CI security jobs, restrict force-push, enable secret
      scanning + Dependabot.
- [ ] Forward audit/security logs to a restricted SIEM and define the alerts.

## Phase 9 — History review & pen test  ·  team  ·  = Phase 10

- [ ] Review git history for any old secret/log; rewrite only if needed
      (destructive — coordinate, force-push, rotate creds, invalidate clones).
- [ ] Arrange an independent penetration test before launch.

---

## Done this session (reference)

- [x] Pushed security-hardening commit `629c367`.
- [x] Wrote the production launch checklist + both env templates.
- [x] Implemented, tested (4/4), and committed idle auto-logout as `ad31808`.
