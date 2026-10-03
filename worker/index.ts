import { Container, getRandom } from "@cloudflare/containers";
import containerEnv from "./container-env.json";

export interface Env {
  ASSETS: Fetcher;
  API_CONTAINER: DurableObjectNamespace<ApiContainer>;
  PROVISIONER_CONTAINER: DurableObjectNamespace<ProvisionerContainer>;
  JOBS_CONTAINER: DurableObjectNamespace<JobsContainer>;

  // Non-secret config (wrangler.jsonc "vars")
  API_INSTANCES: string;
  ALLOWED_ORIGINS: string;
  TRUSTED_HOSTS: string;
  FRONTEND_BASE_URL: string;
  /** Empty on a *.workers.dev host — see baseEnv. */
  COOKIE_DOMAIN?: string;
  MFA_REQUIRED_ROLES: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_FROM_EMAIL: string;
  SMTP_USERNAME: string;
  RUNTIME_DATABASE_ROLE: string;

  // Secrets (wrangler secret put)
  DATABASE_URL: string;
  PROVISIONER_DATABASE_URL: string;
  SECRET_KEY: string;
  MFA_ENCRYPTION_KEY: string;
  SIGNUP_INVITE_CODE: string;
  REDIS_URL: string;
  SMTP_PASSWORD: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_WEATHER_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_AUTOMATIONS_API_KEY?: string;
  UPSTASH_API_EMAIL?: string;
  UPSTASH_API_KEY?: string;
  UPSTASH_DATABASE_ID?: string;
  UPSTASH_MONTHLY_REQUEST_LIMIT?: string;
}

type ContainerRole = keyof typeof containerEnv.roles;

/** The env a container process boots with. The constants, which vars and
 *  secrets get forwarded, and the per-role additions all live in
 *  container-env.json, which the pre-deploy gate (backend/deploy_readiness.py)
 *  reads too, so what it validates is exactly what the containers receive.
 *  Only the provisioner role forwards PROVISIONER_DATABASE_URL; the API
 *  refuses to boot with it. */
function containerEnvFor(env: Env, role: ContainerRole): Record<string, string> {
  const source = env as unknown as Record<string, string | undefined>;
  const { shared } = containerEnv;
  const roleEnv = containerEnv.roles[role];
  const vars: Record<string, string> = { ...shared.constants, ...roleEnv.constants };
  for (const key of [...shared.vars, ...shared.secrets, ...roleEnv.secrets]) {
    const value = source[key];
    if (value !== undefined) vars[key] = value;
  }
  // Optional keys are forwarded only when set. COOKIE_DOMAIN matters most: on a
  // *.workers.dev host there is no parent domain to scope to. workers.dev is on
  // the Public Suffix List, so a Domain attribute naming it is rejected and the
  // session cookie is simply dropped — login would appear to succeed and then
  // not stick. Omitting the variable leaves it None: a correct host-only cookie.
  for (const key of shared.optional) {
    const value = source[key];
    if (value) vars[key] = value;
  }
  return vars;
}

export class ApiContainer extends Container<Env> {
  defaultPort = 8000;
  requiredPorts = [8000];
  sleepAfter = "30m";
  // Postgres, Upstash, SMTP and the Google/DeepSeek APIs are all outbound.
  enableInternet = true;
  pingEndpoint = "/api/health";

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      startOptions: {
        // Includes RATE_LIMIT_TRUST_FORWARDED_FOR=true with one hop: the Worker
        // is the only peer the container sees, so the real client IP arrives as
        // a single X-Forwarded-For entry. Without it every caller would share
        // one rate-limit and lockout bucket.
        envVars: containerEnvFor(this.env, "api"),
      },
    });
    return super.fetch(request);
  }
}

export class ProvisionerContainer extends Container<Env> {
  sleepAfter = "5m";
  enableInternet = true;
  // One-shot: drain the queue of pending tenant schemas, then exit 0.
  entrypoint = ["python", "provision_pending_tenants.py"];

  async drain(): Promise<void> {
    await this.start({
      envVars: containerEnvFor(this.env, "provisioner"),
    });
  }
}

/** Scheduled work (backend/app/jobs): subscription expiry, stale-data purges,
 *  and later the tenant automations. One-shot: runs whatever is due, then
 *  exits. It runs with the DML-only runtime credential; the config validator
 *  refuses it the provisioner's DDL secret. Its own container, rather than an
 *  HTTP call into the API, means no internal endpoint to protect, and no
 *  API instance kept awake by a 15-minute tick. */
export class JobsContainer extends Container<Env> {
  sleepAfter = "5m";
  enableInternet = true;
  entrypoint = ["python", "-m", "app.jobs"];

  async run(): Promise<void> {
    await this.start({
      envVars: containerEnvFor(this.env, "jobs"),
    });
  }
}

function isBackendPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/ws/");
}

/** The warehouse-canvas WebSocket manager keeps its subscriber set in process, so
 *  every peer on a layout has to land on the same container. Pinning on the layout
 *  id (rather than on the whole app) is what lets the API run more than one
 *  instance: each layout is sticky, but different layouts spread out. */
function affinityKey(pathname: string): string | null {
  const canva = pathname.match(/^\/ws\/canva\/([^/?#]+)/);
  if (canva) return `canva-${canva[1]}`;
  // Any other socket route: keep it sticky rather than silently splitting state.
  if (pathname.startsWith("/ws/")) return "ws-default";
  return null;
}

function instanceCount(env: Env): number {
  const parsed = Number.parseInt(env.API_INSTANCES, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** The pool instance a sticky key always lands on. getRandom() spreads plain
 *  requests over "instance-0".."instance-N-1", and a socket key has to map into
 *  that same pool. Naming a container after the key itself ("canva-<layout>")
 *  asked for one container per layout; once the pool was warm, max_instances
 *  left no room to start them and those sockets failed to connect. FNV-1a keeps
 *  a layout on one instance for as long as the pool size doesn't change. */
function poolInstanceName(key: string, instances: number): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `instance-${(hash >>> 0) % instances}`;
}

/** The API marks a response that queued a tenant schema (signup, a verified
 *  email, a Google sign-up, an admin's Retry). Start the provisioner now rather
 *  than at the next 15-minute tick, and keep the marker from the browser. */
const PROVISIONING_QUEUED = "X-Provisioning-Queued";

function startProvisioningIfQueued(response: Response, env: Env, ctx: ExecutionContext): Response {
  if (!response.headers.has(PROVISIONING_QUEUED)) return response;
  ctx.waitUntil(
    env.PROVISIONER_CONTAINER.getByName("provisioner")
      .drain()
      .catch((error: unknown) => console.error("provisioner failed to start", error)),
  );
  const cleaned = new Response(response.body, response);
  cleaned.headers.delete(PROVISIONING_QUEUED);
  return cleaned;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!isBackendPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const sticky = affinityKey(url.pathname);
    if (sticky) {
      // Pass the ORIGINAL request: reconstructing it drops the internal WebSocket
      // handle that carries the upgrade, and the socket would fail to connect.
      // That means a caller-supplied X-Forwarded-For rides through untouched, so
      // the WS path must not be IP-rate-limited on the container side.
      const instance = poolInstanceName(sticky, instanceCount(env));
      return env.API_CONTAINER.getByName(instance).fetch(request);
    }

    // Preserve the caller's IP for slowapi's limiter and the progressive
    // account lockout, both of which key off the right-most X-Forwarded-For entry.
    // The container trusts that entry, so the header must come from us and never
    // from the caller — otherwise a client could mint a fresh rate-limit bucket
    // per request just by varying it. Cloudflare always sets CF-Connecting-IP in
    // production; if it is ever absent, strip the header rather than forward a
    // spoofable one.
    const clientIp = request.headers.get("CF-Connecting-IP");
    const proxied = new Request(request);
    if (clientIp) proxied.headers.set("X-Forwarded-For", clientIp);
    else proxied.headers.delete("X-Forwarded-For");

    // Stateless /api/* — auth is JWT and all state lives in Postgres/Redis, so
    // any instance can serve any request.
    const instances = instanceCount(env);
    // Only replay reads. A mutation that throws may still have been applied on
    // the far side, and re-sending it would risk double-writing a sale or a
    // purchase — so those fail fast and let the caller decide.
    const replayable =
      request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
    const attempts = replayable ? Math.min(instances, 2) : 1;

    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const container = await getRandom(env.API_CONTAINER, instances);
        // Clone per attempt: a failed attempt may already have consumed the body.
        const response = await container.fetch(proxied.clone());
        return startProvisioningIfQueued(response, env, ctx);
      } catch (error) {
        lastError = error;
      }
    }
    console.error("API container unreachable", lastError);
    return new Response(
      JSON.stringify({ detail: "Service temporarily unavailable", code: "upstream_unavailable" }),
      { status: 503, headers: { "content-type": "application/json", "retry-after": "5" } },
    );
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Every 15 minutes, start both one-shot containers:
    //  - the provisioner drains queued tenant schemas. In production, signup,
    //    email verification and Google sign-in only queue a tenant, so this is
    //    how every new tenant gets its schema.
    //  - the jobs runner runs whatever scheduled work is due.
    // allSettled: one failing to start must not stop the other.
    const started = Promise.allSettled([
      env.PROVISIONER_CONTAINER.getByName("provisioner").drain(),
      env.JOBS_CONTAINER.getByName("jobs").run(),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected")
          console.error("scheduled container failed to start", result.reason);
      }
    });
    ctx.waitUntil(started);
  },
};
