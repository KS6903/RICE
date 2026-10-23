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
| `legal/` | Terms of service, privacy policy, the employee notice template and the entity details |
| `scripts/` | `ci_local.mjs` (an optional local copy of the CI checks) and git setup |

## Running it locally

[SETUP.md](SETUP.md) has the full steps. In short:

```bash
cd backend
alembic upgrade head          # public schema; then migrate_all_tenants.py for tenant schemas
python seed.py                # reference data: roles, rice varieties, grades
python run.py                 # API on http://localhost:8000, docs at /api/docs

cd ..
npm install
npm run dev:web               # web app on http://localhost:8448
```

The API doesn't reload on its own: restart it after a backend change, and run
`alembic upgrade head` after a migration. The first platform admin is created with
`backend/create_platform_admin.py`.

## Plans

As set by migration 019 (`019_plan_tiers`). The platform admin can change them in the console.
Users include the owner. Each warehouse is a branch: "Add warehouse" creates one.

| Plan | Users | Warehouses | Adds |
| --- | --- | --- | --- |
| Free | 3 | 1 | Dashboard, palay, inventory, sales, expenses, users |
| Basic | 5 | 3 | Milling, dispatch, palay drying advice |
| Pro | 15 | 5 | Field operators, cash count, collections, employees, advanced reports, warehouse view |
| Enterprise | Unlimited | Unlimited | Automations, To do, stock count, maintenance, compliance reports, offline desktop sync |

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
- **Load a backup** into an empty tenant from its page. There are no owner's checks (confirmed
  email, new login, password, plan branches). Enter the email of the owner who downloaded it, or
  keep the Boss's email that's filled in. The records then belong to the tenant's Boss.
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
accountant, mill operator. The `email` part gives each Boss the confirmed address
`millN@example.com`. A backup is sealed to the owner's email, so without one it can't be made.

## Pushing and CI

Work goes straight to `main`, with no pull requests. Every push to `main` runs CI on GitHub
(`.github/workflows/ci.yml`, which calls `checks.yml`), and the preview deploys itself only when
that run passes. Nothing runs before the push.

`npm run ci:local` runs the same checks on this machine, if you want them before pushing:
`-- --fast` for the quick subset, or the full run in about 50 minutes. It needs `gitleaks`
(`winget install Gitleaks.Gitleaks`, or `GITLEAKS_BIN`).

- All backend test runs share one test database, so run one pytest session at a time.
- The end-to-end suites start their own disposable backend (:8001) and, for the browser suite, a
  second web dev server (:8449), on a database whose name must contain `e2e`. They never touch the
  everyday :8448/:8000 stack. The browser suite needs `npx playwright install chromium` once.

Deploys are started by hand (`deploy.yml`, from `main` only) and pass the same checks, plus
`backend/deploy_readiness.py`. That check fails until the `example.com` values in `wrangler.jsonc`
and the placeholders in `legal/entity.json` are filled in. A private test site for invited
testers deploys separately, with `deploy-preview.yml`; see [PREVIEW_DEPLOY.md](PREVIEW_DEPLOY.md).

CI and both deploys run on GitHub's `ubuntu-latest` runners. The repository variable `CI_RUNNER`
can point them at another runner, but never at a self-hosted one while the repository is public.

## More documentation

- [SETUP.md](SETUP.md): local setup step by step, and how offline sync works
- [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md): who it's for, and the visual system
- [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md): what runs where in production, and how to deploy
- [PREVIEW_DEPLOY.md](PREVIEW_DEPLOY.md): the private test site for invited testers, and its costs
- [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md): what's left before launch
- [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md): release gate, e2e databases, account recovery
