# RICE

An ERP for Philippine rice mills, sold as multi-tenant SaaS: palay purchasing, milling, inventory,
sales, dispatch, expenses, payroll and reports. Each mill is a tenant with its own PostgreSQL
schema. Two kinds of people use it: the mill's own staff, and the platform admin who runs the
service from the `/admin` console. [PRODUCT.md](PRODUCT.md) describes who they are and what the
product is for.

## What's in the repo

| Path | What it is |
| --- | --- |
| `backend/` | FastAPI API, SQLAlchemy models, Alembic migrations, seeders, pytest suites |
| `packages/web/` | React + Vite web app: the mill app and the platform admin console |
| `packages/shared/` | Types and constants shared by web and desktop (roles, labels) |
| `packages/desktop/` | Electron app that works offline on local SQLite and syncs back |
| `worker/` | Cloudflare Worker: serves the web app and routes `/api` to the API container |
| `e2e/` | Playwright tests (API suite and browser suite) |
| `legal/` | Terms of service, privacy policy, data processing addendum and the entity details |
| `scripts/` | `ci_local.mjs` (the local CI mirror) and git hook setup |

## Running it locally

[SETUP.md](SETUP.md) has the full steps. In short:

```bash
cd backend
alembic upgrade head          # public schema; then migrate_all_tenants.py for tenant schemas
python seed.py                # reference data: roles, rice varieties, grades
python run.py                 # API on http://localhost:8000, docs at /api/docs

cd ..
npm install                   # also turns on the pre-push hook
npm run dev:web               # web app on http://localhost:8448
```

The API doesn't reload on its own: restart it after a backend change, and run
`alembic upgrade head` after a migration. The first platform admin is created with
`backend/create_platform_admin.py`.

## Plans

As seeded by the baseline migration. The platform admin can change them in the console.

| Plan | Users | Branches | Adds |
| --- | --- | --- | --- |
| Free | 3 | 1 | Dashboard, palay, milling, inventory, sales, expenses, users |
| Basic | 7 | 2 | Multiple branches |
| Pro | 15 | 5 | Employees and payroll, advanced reports |
| Enterprise | Unlimited | Unlimited | Compliance reports, offline desktop sync, automations, drying advisor |

## Roles and staff accounts

A mill's accounts have one of six roles: **Boss** (`owner`), **Admin**, **Accountant**,
**Cashier**, **Mill operator** and **Encoder**. What each role can open is set in one table,
`SECTION_ACCESS` in [backend/app/core/security.py](backend/app/core/security.py).

- The Boss and Admins add staff on the **Users** page, up to the plan's user limit. The Boss
  counts toward it, and a removed user frees their seat.
- Only the Boss can make someone a Boss, change a Boss account, or give a locked-out employee a
  temporary password. A locked-out Boss asks the platform admin for one.
- Adding, re-roling, removing and restoring an account is written to the mill's activity log,
  with who did it.
- Usernames are unique across every mill, not just within one.
- Two-factor sign-in is optional for mill accounts and always on for platform admins. The
  production readiness check still requires it for owners and admins (`MFA_REQUIRED_ROLES`).

## Platform admin console (`/admin`)

- **Tenants:** each mill's company details, subscription, branches and totals; every user
  account with its role, status, creation date and last sign-in; the **terms acceptance**
  ledger; and the mill's activity log (the latest 200 entries).
- **Terms acceptance** shows each time someone agreed to the terms: the version, a SHA-256
  fingerprint of the exact text they were shown, how (at sign-up or at sign-in), when and from
  which IP, plus anyone who hasn't accepted the current version. It's read-only, and the runtime
  database role can't change or delete its rows.
- **All users:** search across every mill, and give a locked-out Boss a temporary password.
- **Upgrade requests** and **plans**.

## Test mills and demo data

These logins exist only in a local database. Each `millN` login is the Boss of its own company,
"Rice Mill N", and every test login uses the password `password123`. The seeders fill in tenants
that already exist; they don't create the `millN` logins.

| Mill | Plan | Staff logins |
| --- | --- | --- |
| `mill1` | Enterprise | `accountant`, `cashier`, `encoder`, `mill.operator` |
| `mill2`, `mill6`, `mill8` | Free | `millN.cashier`, `millN.encoder` |
| `mill3` | Basic | `millN.cashier`, `millN.encoder`, `millN.accountant`, `millN.operator` |
| `mill4`, `mill5`, `mill7` | Pro | `millN.cashier`, `millN.encoder`, `millN.accountant`, `millN.operator` |

- New features go to Tier 1 (`mill1`–`mill3`) first, then Tier 2 (`mill4`–`mill8`).
- `mill1` is the main test tenant and the one the e2e tests sign in as.
- An Enterprise-only feature is demoed on `mill1` alone. `mill2` (Free) and `mill3` (Basic) are
  where you check that the plan gate refuses it.

`backend/seed_demo.py` runs every demo seeder in order:

```bash
python seed_demo.py                    # Tier 1: mill1-mill3
python seed_demo.py --all              # mill1-mill8
python seed_demo.py --only staff,sales # just these parts: base, staff, inventory, sales, automations
```

It can run again safely, and it refuses a database that isn't on this machine. The `staff` part
gives each mill as many staff logins as its plan has room for, in the order cashier, encoder,
accountant, mill operator.

## Checks before pushing to main

`npm install` turns on `.githooks/pre-push`. On any push to `main` it runs
`scripts/ci_local.mjs`, a local copy of the GitHub checks (`.github/workflows/checks.yml`), and
blocks the push if a required check fails. A full run takes about 25 minutes, mostly the backend
tests, the web build and Semgrep. `npm run ci:local -- --fast` runs the quick subset by hand.

- The tree must be clean, and `gitleaks` must be installed (`winget install Gitleaks.Gitleaks`)
  or named in `GITLEAKS_BIN`.
- Don't bypass the hook with `--no-verify`; fix what it reports.
- All backend test runs share one test database, so run one pytest session at a time.

Deploys are started by hand (`deploy.yml`, from `main` only) and pass the same checks, plus
`backend/deploy_readiness.py`. That check fails until the `example.com` values in `wrangler.jsonc`
and the placeholders in `legal/entity.json` are filled in. A private test site for invited
testers deploys separately, with `deploy-preview.yml`; see [PREVIEW_DEPLOY.md](PREVIEW_DEPLOY.md).

## More documentation

- [SETUP.md](SETUP.md): local setup step by step, and how offline sync works
- [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md): who it's for, and the visual system
- [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md): what runs where in production, and how to deploy
- [PREVIEW_DEPLOY.md](PREVIEW_DEPLOY.md): the private test site for invited testers, and its costs
- [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md): what's left before launch
- [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md): release gate, e2e databases, account recovery
- [OUTSTANDING.md](OUTSTANDING.md): the roadmap of remaining work
