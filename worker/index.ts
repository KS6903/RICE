import { Container, getRandom } from "@cloudflare/containers";

export interface Env {
  ASSETS: Fetcher;
  API_CONTAINER: DurableObjectNamespace<ApiContainer>;
  PROVISIONER_CONTAINER: DurableObjectNamespace<ProvisionerContainer>;

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
}

/** Config shared by both process roles. Anything role-specific is added by the
 *  caller — notably PROVISIONER_DATABASE_URL, which the API refuses to boot with. */
function baseEnv(env: Env): Record<string, string> {
  const vars: Record<string, string> = {
    ENV: "prod",
    DEBUG: "false",
    RUNTIME_DATABASE_ROLE: env.RUNTIME_DATABASE_ROLE,
    DATABASE_URL: env.DATABASE_URL,
    SECRET_KEY: env.SECRET_KEY,
    MFA_ENCRYPTION_KEY: env.MFA_ENCRYPTION_KEY,
    SIGNUP_INVITE_CODE: env.SIGNUP_INVITE_CODE,
    REDIS_URL: env.REDIS_URL,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
    TRUSTED_HOSTS: env.TRUSTED_HOSTS,
    FRONTEND_BASE_URL: env.FRONTEND_BASE_URL,
    COOKIE_SECURE: "true",
    EXPOSE_RESET_TOKEN: "false",
    RATE_LIMIT_ENABLED: "true",
    MFA_ENFORCE: "true",
    MFA_REQUIRED_ROLES: env.MFA_REQUIRED_ROLES,
    REQUIRE_EMAIL_VERIFICATION: "true",
    PASSWORD_BREACH_CHECK: "true",
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: env.SMTP_PORT,
    SMTP_STARTTLS: "true",
    SMTP_FROM_EMAIL: env.SMTP_FROM_EMAIL,
    SMTP_USERNAME: env.SMTP_USERNAME,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
  };
  // Only set COOKIE_DOMAIN when there is a real parent domain to scope to. On a
  // *.workers.dev host there is none: workers.dev is on the Public Suffix List,
  // so a Domain attribute naming it is rejected and the session cookie is simply
  // dropped — login would appear to succeed and then not stick. Omitting the
  // variable leaves it None, which yields a correct host-only cookie.
  if (env.COOKIE_DOMAIN) vars.COOKIE_DOMAIN = env.COOKIE_DOMAIN;
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_WEATHER_API_KEY", "DEEPSEEK_API_KEY"] as const) {
    const value = env[key];
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
        envVars: {
          ...baseEnv(this.env),
          PROCESS_ROLE: "api",
          // The Worker is the only peer the container sees, so the real client
          // IP is forwarded as a single hop (RATE_LIMIT_FORWARDED_HOPS=1).
          // Without this every caller shares one rate-limit and lockout bucket.
          RATE_LIMIT_TRUST_FORWARDED_FOR: "true",
          RATE_LIMIT_FORWARDED_HOPS: "1",
        },
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
      envVars: {
        ...baseEnv(this.env),
        PROCESS_ROLE: "provisioner",
        PROVISIONER_DATABASE_URL: this.env.PROVISIONER_DATABASE_URL,
      },
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return env.API_CONTAINER.getByName(sticky).fetch(request);
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
    const replayable = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
    const attempts = replayable ? Math.min(instances, 2) : 1;

    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const container = await getRandom(env.API_CONTAINER, instances);
        // Clone per attempt: a failed attempt may already have consumed the body.
        return await container.fetch(proxied.clone());
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

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Safety net only — signup and Google auth provision inline. This catches
    // tenants whose provisioning failed and were left queued.
    await env.PROVISIONER_CONTAINER.getByName("provisioner").drain();
  },
};
