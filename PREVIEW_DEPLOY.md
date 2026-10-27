# Preview site on Cloudflare

A trimmed copy of Oraiza at `https://app.oraiza.workers.dev`. Sign-up is open to anyone behind
Turnstile (`SIGNUP_OPEN` in `wrangler.jsonc`); step 7 locks it to a list of people instead. It
runs the same code with the production security settings, except in two places (`ENV=preview`):

- the legal documents may still show "To follow" where your company details aren't filled in;
- email is optional, so email verification is off unless you add an email account.

Production keeps both checks. The preview is set up in `wrangler.jsonc` under `env.preview`,
checked by `backend/deploy_readiness.py --env preview`, and deployed by the
**Deploy preview (Cloudflare)** workflow.

## What it costs

| Piece | Service | Cost |
| --- | --- | --- |
| Web app, API and provisioner | Cloudflare Workers Paid (containers need it) | $5 a month |
| Database | Neon Free | $0 (1 GB, sleeps after 5 minutes idle) |
| Redis | Upstash Free | $0 |
| Sign-in gate | Cloudflare Zero Trust Free | $0 for up to 50 people (it asks for a card on file) |
| Email (optional) | A Gmail address with an app password | $0 |

The $5 plan includes 25 GiB-hours of container memory and 375 vCPU-minutes a month, and
containers are billed only while awake. The preview is trimmed to stay close to that: one small
API container (`basic`: ¼ vCPU, 1 GiB) that sleeps after 10 minutes idle.

The 15-minute cron (`env.preview.triggers` in `wrangler.jsonc`) wakes the provisioner and the
jobs runner about 96 times a day each. Those two are one-shot containers that exit when their work
is done, but they add to the hours above. The usage figures this page used to give (about $5.15 a
month for an hour of use a day) were worked out without the cron, so check Cloudflare's usage page
after the first week instead of trusting them.

The cron is what runs the scheduled jobs: subscription expiry, automations and their emails,
clean-ups. Without it none of them run, and the Automations page says "Automatic runs are
paused on this server". A new sign-up still gets its database schema without it: the sign-up
itself starts the provisioner.

## One-time setup

Do these in order. Billing starts at step 1.

### 1. Cloudflare

1. In the project's Cloudflare account, subscribe to **Workers Paid** (Workers & Pages → Plans).
2. The account's `workers.dev` subdomain is `oraiza` (Workers & Pages overview, right-hand side),
   and `wrangler.jsonc` `env.preview.vars` already uses it. If you ever change the subdomain,
   change those three hosts too.
3. Create an API token (My Profile → API Tokens) from the **Edit Cloudflare Workers** template,
   for the project's account only, and add **Containers: Edit**. Note the token and the
   account ID.

### 2. Database (Neon)

1. Create a Neon project in **Singapore** (the closest region to the Philippines). Copy the
   connection string for its owner role. That is the *provisioner* credential: it can change
   the database's structure, so only the migrations and the provisioner get it. It must end in
   `sslmode=require`.
2. Create the API's restricted role with the repository's script. From `B:\RICE`, using the
   `psql` that came with your local PostgreSQL:

   ```powershell
   & "C:\Program Files\PostgreSQL\15\bin\psql.exe" "<owner connection string>" `
     -v app_password='<a new strong password>' -f backend/scripts/db_least_privilege.sql
   ```

   The API's connection string is the same one with `ricemill_app:<that password>` in place of
   the owner's name and password.

### 3. Redis (Upstash)

Create a free Redis database at Upstash and copy its `rediss://` URL.

### 4. GitHub secrets

In the repository: Settings → Secrets and variables → Actions → **New repository secret**:

| Name | Value |
| --- | --- |
| `PREVIEW_PROVISIONER_DATABASE_URL` | Neon's owner connection string |
| `PREVIEW_CLOUDFLARE_API_TOKEN` | the API token from step 1 |
| `PREVIEW_CLOUDFLARE_ACCOUNT_ID` | the Cloudflare account ID |

### 5. Deploy

GitHub → Actions → **Deploy preview (Cloudflare)** → Run workflow, on `main`. It runs the full
checks, the preview readiness gate, brings Neon up to date, then deploys the Worker and builds
the containers. After that it deploys itself after every push to `main` whose CI passed, so a
change to `wrangler.jsonc` (the cron included) goes live when it is merged.

### 6. Worker secrets

From `backend/`, after `npx wrangler login`:

```powershell
.\.venv\Scripts\python.exe generate_security_secrets.py --env preview --only SECRET_KEY MFA_ENCRYPTION_KEY
npx wrangler secret put SIGNUP_INVITE_CODE --env preview        # type your own, 16+ characters
npx wrangler secret put DATABASE_URL --env preview              # the ricemill_app connection string
npx wrangler secret put PROVISIONER_DATABASE_URL --env preview  # Neon's owner connection string
npx wrangler secret put REDIS_URL --env preview                 # the rediss:// URL
```

The invite code is the one secret you type yourself, because you'll give it to your testers;
the script never shows the ones it makes. The containers read the secrets when they start, so
set them before anyone opens the site.

### 7. Lock it to your testers (optional)

Skip this while the site is open to everyone. Otherwise: Workers & Pages → **app** → Settings → Domains & Routes → `workers.dev` →
**Enable Cloudflare Access**, then **Manage Cloudflare Access** and add each tester's email.
Anyone else gets Cloudflare's sign-in page and goes no further.

### 8. First accounts

1. The platform admin's password lives in Cloudflare, not the database. From `backend/`, make a
   hash of the password (`.\.venv\Scripts\python.exe create_platform_admin.py --hash`), then put
   it in the Worker's secrets with the username:

   ```powershell
   npx wrangler secret put PLATFORM_ADMIN_USERNAME --env preview
   npx wrangler secret put PLATFORM_ADMIN_PASSWORD_HASH --env preview   # the hash, never the password
   npx wrangler secret put PLATFORM_ADMIN_EMAIL --env preview           # optional, for the warnings
   ```

   The API makes that account when it starts. To change the password, put a new hash there: the
   admin is signed out everywhere and the old email address is warned. Anyone who can edit the
   Worker can do the same, so keep that right to yourself; they'd still need your two-factor code.
   (`create_platform_admin.py` without `--hash` still makes an ordinary admin in the database.)

2. Each mill signs up on the site. While `SIGNUP_OPEN` is `"true"` (it is now) no invite code is
   needed; otherwise they enter `SIGNUP_INVITE_CODE`. Owners and admins set up two-factor
   sign-in on their first visit, as in production.
3. In the admin console, set each mill's plan (Admin → Tenants).
4. Optional demo data for a mill: from `backend/`, with `$env:DATABASE_URL` set as above,
   `.\.venv\Scripts\python.exe seed_demo.py <owner username> --allow-remote`.

## Later

- **Email:** set `SMTP_HOST` (`smtp.gmail.com`), `SMTP_FROM_EMAIL` and `SMTP_USERNAME` in
  `env.preview.vars`, put the Gmail app password with
  `npx wrangler secret put SMTP_PASSWORD --env preview`, and redeploy. To require verification
  too, set `REQUIRE_EMAIL_VERIFICATION` to `"true"` under `targets.preview` in
  `worker/container-env.json`; the readiness gate then insists on the email settings.
- **Going live:** the real launch uses the top-level `wrangler.jsonc` config and the **Deploy
  (Cloudflare)** workflow, on your own domain. See [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md)
  and [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md).
