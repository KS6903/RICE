# Cloudflare deployment

How Oryza runs on Cloudflare, and the steps to deploy it. Companion to
[PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md) — the database-role,
secret-generation and monitoring phases there still apply.

This page is the production deployment. The private test site for invited testers is a trimmed
copy of it (`wrangler.jsonc` `env.preview`, one small container, no cron); see
[PREVIEW_DEPLOY.md](PREVIEW_DEPLOY.md).

## What runs where

| Piece | Cloudflare home |
|---|---|
| React SPA (`packages/web`) | Workers static assets, served by the Worker |
| FastAPI API | `ApiContainer` — Cloudflare Container, `PROCESS_ROLE=api` |
| Tenant provisioner | `ProvisionerContainer` — woken every 15 min by a Cron Trigger |
| Scheduled jobs (`backend/app/jobs`) | `JobsContainer` — woken by the same Cron Trigger |
| PostgreSQL | PlanetScale Postgres, provisioned and billed through Cloudflare |
| Redis | Upstash (`rediss://`) — see "Why Redis is off-platform" |

The Worker ([worker/index.ts](worker/index.ts)) routes `/api/*` and `/ws/*` to the API
container and serves everything else from the SPA bundle, so the app stays single-origin.
That is what lets `packages/web/src/services/api.ts` keep its relative `/api` baseURL and
the build-time CSP keep `connect-src 'self'`.

## Load balancing

The Worker is the load balancer — no separate proxy and no Cloudflare Load Balancing
subscription. An origin-side proxy (HAProxy, Nginx, Traefik) would have to run *inside* a
container behind the Worker, adding a hop and a failure point without adding capability,
since the Worker already terminates TLS and routes.

Two routing classes, because they have different correctness requirements:

- **`/ws/canva/{layout_id}` — sticky.** The canvas WebSocket manager keeps its subscriber
  set in process, so every peer on a layout must reach the same container. The affinity key
  is the *layout*, not the app, so different layouts spread across instances. This is what
  allows more than one API instance at all.
- **`/api/*` — balanced.** Auth is JWT and all state lives in Postgres or Redis, so any
  instance can serve any request. Spread with `getRandom()` across `API_INSTANCES`.

Failover only replays **GET/HEAD/OPTIONS**. A mutation that throws may still have been
applied upstream, and re-sending it could double-write a sale or purchase, so those fail
fast with a 503 and `Retry-After` rather than risk a duplicate.

To scale, raise `API_INSTANCES` and `ApiContainer.max_instances` together — the Worker
never balances across more instances than the container is allowed to run.

### Why there are three containers

`app/core/config.py` refuses to boot the API when `PROVISIONER_DATABASE_URL` is in scope,
and requires it when `PROCESS_ROLE=provisioner`. The DDL credential is deliberately kept
out of the long-running API process, so the two roles cannot share a container.

The jobs runner (`PROCESS_ROLE=jobs`) has its own container too. It needs only the
DML-only runtime credential, and the validator refuses it the DDL one. A one-shot
container started by the cron means there's no internal HTTP endpoint to protect, and no API
instance kept awake by the 15-minute tick. All three share one image and differ only by
entrypoint and env. Each run is claimed in `job_runs` first, so no job runs twice.

### Why Redis is off-platform

Cloudflare has no managed Redis. The prod validator requires one anyway:

```
REDIS_URL is required for shared rate-limit and lockout state
REDIS_URL must use TLS (rediss://) in production
```

Progressive account lockout ([app/core/ratelimit.py](backend/app/core/ratelimit.py)) is
built on it — without Redis, `register_login_failure` always reports "not locked" and only
the per-IP limit remains. Upstash gives a `rediss://` endpoint that satisfies the validator
as written. Its free tier is 500k commands/month; slowapi touches Redis on every request,
so expect to outgrow that under real multi-tenant load.

## One-time setup

### 1. Database

Create a PlanetScale Postgres database from the Cloudflare dashboard (billed to your
Cloudflare account). Then create the two roles per
[PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md) Phase 1 — a DML-only
runtime role and a separate owner/DDL provisioner role. Both connection strings must
include `sslmode=require`.

### 2. Redis

Create an Upstash Redis database and copy its `rediss://` URL.

### 3. Secrets

The app's own three secrets (`SECRET_KEY`, `MFA_ENCRYPTION_KEY`, `SIGNUP_INVITE_CODE`) are
generated straight into the Worker. Nothing is printed, and nothing is written to disk. It sets
only the ones the Worker doesn't have yet, and it never rotates `MFA_ENCRYPTION_KEY` (every
user's two-factor seed is encrypted with it):

```bash
cd backend && .venv/Scripts/python.exe generate_security_secrets.py
```

Then the rest, from their sources:

```bash
wrangler secret put DATABASE_URL              # runtime role, sslmode=require
wrangler secret put PROVISIONER_DATABASE_URL  # owner/DDL role, different user
wrangler secret put REDIS_URL                 # rediss:// from Upstash
wrangler secret put SMTP_PASSWORD
# Optional — omit to leave the feature disabled:
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_WEATHER_API_KEY
wrangler secret put DEEPSEEK_API_KEY
```

### 4. Domain

Replace every `example.com` value in the `vars` block of
[wrangler.jsonc](wrangler.jsonc) with the real domain, and point the route at your Worker.
`ALLOWED_ORIGINS`, `TRUSTED_HOSTS` and `FRONTEND_BASE_URL` are all enforced at boot.

### 5. Migrations

The Deploy workflow runs them in its `migrate` job, after the checks and before the rollout: the
public schema, then every tenant schema, and the deploy stops if any tenant fails. It needs
`PROVISIONER_DATABASE_URL` in the `production` environment's secrets and `RUNTIME_DATABASE_ROLE`
in its variables, and the database must accept connections from GitHub's runners.

By hand, against the provisioner credential, from a machine that can reach the database:

```bash
cd backend
PROCESS_ROLE=provisioner .venv/Scripts/python.exe -m alembic upgrade head
PROCESS_ROLE=provisioner .venv/Scripts/python.exe migrate_all_tenants.py
```

## Deploying

```bash
npm run cf:deploy    # builds the SPA, then wrangler deploy
```

Requires Docker running locally — wrangler builds the container image before uploading.
To ship a Worker-only change without touching the containers, add
`--containers-rollout=none`.

Validate config without deploying:

```bash
npx wrangler deploy --dry-run --containers-rollout=none
npm run cf:typecheck
```

## Known limits

- **Containers are beta** — no SLA, the API may change, deploys roll out gradually rather
  than instantly, and cold starts run 2–3s.
- **No autoscaling.** Instance count is fixed by `API_INSTANCES`, not demand-driven —
  Containers has no autoscaler, so raising capacity is a config change and a redeploy.
- **Ephemeral disk.** Containers keep no local state between restarts; everything durable
  lives in Postgres or Redis.
- **Cron cadence.** The provisioner and the jobs runner start every 15 minutes. In
  production, signup, email verification and Google sign-in only *queue* a new tenant, so
  a new customer can wait up to 15 minutes plus a cold start for their schema. Scheduled
  jobs run on the first tick after they fall due, in each tenant's timezone.
