import logging
import re
from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger("ricemill.config")

# Substrings that should never appear in a real secret. Kept narrow on purpose so
# CI's throwaway key ("ci-test-secret-key") is NOT flagged — only the shipped
# .env.example placeholder and obvious "fill me in" values are rejected.
_PLACEHOLDER_SECRET_MARKERS = (
    "change_me",
    "changeme",
    "replace_me",
    "your_random",
    "placeholder",
    "generate_a_long_random",
)
_MIN_SECRET_LEN = 32
# What core/security.hash_password makes: $2b$, a two-digit cost, 53 characters of salt and hash.
_BCRYPT_HASH = re.compile(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}")


class Settings(BaseSettings):
    DATABASE_URL: str
    # Tenant schemas are created through a separate migration/provisioning
    # credential. The API's DATABASE_URL must be a DML-only role in production.
    PROVISIONER_DATABASE_URL: SecretStr | None = None
    RUNTIME_DATABASE_ROLE: str = "ricemill_app"
    # api: the web API. provisioner: tenant DDL (the only role that may hold
    # PROVISIONER_DATABASE_URL). jobs: scheduled work (app/jobs), DML only.
    PROCESS_ROLE: Literal["api", "provisioner", "jobs"] = "api"
    SECRET_KEY: str
    ALGORITHM: Literal["HS256"] = "HS256"
    JWT_ISSUER: str = "oraiza-api"
    JWT_AUDIENCE: str = "oraiza-clients"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # "Remember this device" for MFA: after a successful TOTP/backup-code verify,
    # this device skips the MFA step on login until the next weekly reset — the
    # upcoming Sunday 00:00 in the user's own local time (core/mfa_trust.py) —
    # so every device re-prompts once a week, on Sunday. Signing out doesn't
    # reset it. Set MFA_TRUST_ENABLED=false for MFA on every login.
    MFA_TRUST_ENABLED: bool = True
    ALLOWED_ORIGINS: str = "http://localhost:8448,http://localhost:3000"
    APP_NAME: str = "Oraiza by K Systematics"
    DEBUG: bool = False
    # Deployment environment. "prod" turns on fail-closed config checks (see the
    # model validator below) and enables HSTS. "preview" is the private test site
    # behind Cloudflare Access: production behaviour and the same checks, except
    # that the published agreements may still hold "To follow" details and email
    # (so also email verification) is optional. Leave as "dev" locally / in CI.
    # Closed enum: a typo such as ENV=production must fail validation instead
    # of silently selecting insecure development behavior.
    ENV: Literal["dev", "test", "prod", "preview"] = "dev"
    # Host allowlist for Starlette's TrustedHostMiddleware. "*" (dev default)
    # accepts any Host header; prod MUST set an explicit comma-separated list.
    TRUSTED_HOSTS: str = "*"
    # Cookie security for the httpOnly session cookies. Secure cookies are only
    # sent over HTTPS, so we disable that flag in dev (http://localhost).
    COOKIE_SECURE: bool = False
    COOKIE_DOMAIN: str | None = None
    # ── Rate limiting (slowapi). Disabled in tests via env (see tests/conftest). ─
    RATE_LIMIT_ENABLED: bool = True
    # Global per-IP default applied to every endpoint. Empty string disables the
    # global throttle (per-route auth limits still apply).
    RATE_LIMIT_DEFAULT: str = "1000/minute"
    # Tighter limit on the unauthenticated auth endpoints (login/signup/refresh/…).
    RATE_LIMIT_AUTH: str = "10/minute"
    # Behind a reverse proxy the socket peer is the proxy, so everyone would
    # share one rate-limit bucket. Enable this ONLY when you actually run behind
    # a proxy you control, and set FORWARDED_HOPS to the number of proxies in
    # front of the app (the client IP is read that many entries from the right of
    # X-Forwarded-For; entries further left are client-spoofable and ignored).
    RATE_LIMIT_TRUST_FORWARDED_FOR: bool = False
    RATE_LIMIT_FORWARDED_HOPS: int = 1
    # Account lockout: PROGRESSIVE. Failed logins for a username are counted in a
    # sliding LOGIN_LOCKOUT_WINDOW_SECONDS window; reaching the (shrinking) attempt
    # threshold locks the account for a (growing) duration. Each lockout "round"
    # lowers the threshold (toward LOGIN_MIN_FAILURES) and multiplies the lockout
    # duration (by LOGIN_LOCKOUT_FACTOR, capped at LOGIN_LOCKOUT_MAX_SECONDS). After
    # LOGIN_LOCKOUT_MAX_ROUNDS lockouts the account is PERMANENTLY locked and can
    # only be freed by a password reset. Backed by Redis; a no-op when Redis is
    # unavailable (the per-IP rate limit still holds as the floor of protection).
    LOGIN_MAX_FAILURES: int = 5  # attempts allowed in the first round
    LOGIN_MIN_FAILURES: int = 2  # floor — threshold never drops below this
    LOGIN_LOCKOUT_WINDOW_SECONDS: int = 900  # window failures are counted within
    LOGIN_LOCKOUT_BASE_SECONDS: int = 60  # first lockout duration
    LOGIN_LOCKOUT_FACTOR: int = 5  # each round multiplies the duration
    LOGIN_LOCKOUT_MAX_SECONDS: int = 86400  # cap on any single lockout (24h)
    LOGIN_LOCKOUT_MAX_ROUNDS: int = 5  # lockouts before a permanent block
    # How long the escalation memory (round counter) and the permanent block live in
    # Redis. The round counter decays so an honest user who later mistypes once isn't
    # treated as a serial offender; the permanent flag is effectively durable.
    LOGIN_LOCKOUT_ROUND_TTL_SECONDS: int = 86400  # 1 day
    LOGIN_LOCKOUT_PERMANENT_TTL_SECONDS: int = 2592000  # 30 days
    # A temporary password (given to someone locked out) stops working after this
    # long, and must be replaced by one of their own at first sign-in.
    TEMP_PASSWORD_HOURS: int = 24
    # MFA enforcement. When on, platform admins and any accounts in
    # MFA_REQUIRED_ROLES must enroll in TOTP before they can use the app — the API
    # blocks data endpoints until they do, and they can't turn it off. Disabled in
    # tests via env.
    #
    # MFA_REQUIRED_ROLES lists the roles obliged to use MFA (they can't turn it off).
    # It is empty by default; the production readiness check below still requires
    # it to include owner and admin, so a production deploy must set it.
    MFA_ENFORCE: bool = True
    MFA_REQUIRED_ROLES: str = ""
    # Opt-in breached-password check (HIBP k-anonymity) on signup/password change.
    # Best-effort: any network failure means "allow", so offline deployments are
    # never blocked. Recommended true where the server has internet access.
    PASSWORD_BREACH_CHECK: bool = False
    # Password-reset token lifetime (minutes).
    PASSWORD_RESET_TOKEN_MINUTES: int = 30
    # Where to send emailed links (reset, verification). With no email provider
    # wired up, the link is logged server-side; when this is true (dev only) the
    # raw token is also returned in the API response so the flows are testable
    # end-to-end. The prod config validator forces this off.
    EXPOSE_RESET_TOKEN: bool = False
    # Public base URL emailed links point at (the web app's origin).
    FRONTEND_BASE_URL: str = "http://localhost:8448"
    # Email verification. The flow always runs on signup; REQUIRE_EMAIL_VERIFICATION
    # additionally blocks data endpoints until the address is confirmed.
    REQUIRE_EMAIL_VERIFICATION: bool = False
    EMAIL_VERIFICATION_TOKEN_HOURS: int = 48
    # Optional — when present, /api/weather hits Google's Weather API. Otherwise
    # the endpoint falls back to Open-Meteo (no key required), so the widget
    # works out of the box.
    GOOGLE_WEATHER_API_KEY: str | None = None
    GOOGLE_CLIENT_ID: str | None = None
    # Optional — powers the Enterprise-only palay Drying Advisor (DeepSeek chat
    # completions, OpenAI-compatible). The advisory endpoint returns "not
    # configured" (501) when unset; nothing else in the app depends on it.
    DEEPSEEK_API_KEY: SecretStr | None = None
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    # The Flash model: the Drying Advisor, and every AI automation marked
    # ai_model="flash" (all of them today). The old "deepseek-chat" alias now
    # maps to this same model anyway and is being retired 2026-07-24, so this
    # pins the real identifier rather than riding a soon-dead legacy name.
    DEEPSEEK_MODEL: str = "deepseek-flash"
    # The Enterprise AI automations (app/automations/ai.py) use their own key
    # when set (to bill or rotate it apart), else the one above.
    DEEPSEEK_AUTOMATIONS_API_KEY: SecretStr | None = None
    # The Pro model, for an AI automation marked ai_model="pro" (none today;
    # automations/ai.py says why).
    DEEPSEEK_AUTOMATIONS_MODEL: str = "deepseek-v4-pro"
    # Online plan payments (services/payment_service.py). Each provider is offered
    # at checkout only when its keys are set; bank transfer is always there.
    # PayMongo: pesos (GCash, Maya, QR Ph, cards, online banking). The webhook
    # secret comes from creating the webhook (dashboard, Developers > Webhooks).
    PAYMONGO_SECRET_KEY: SecretStr | None = None
    PAYMONGO_WEBHOOK_SECRET: SecretStr | None = None
    # PayPal: US dollars, for mills paying from abroad. "sandbox" for test keys.
    PAYPAL_CLIENT_ID: str | None = None
    PAYPAL_CLIENT_SECRET: SecretStr | None = None
    PAYPAL_ENV: Literal["sandbox", "live"] = "sandbox"
    # Advisory calls cost money per request; kept tight since the endpoint is
    # also cached server-side for hours per location/day (see TTL_DRYING_ADVISORY).
    RATE_LIMIT_DRYING_ADVISOR: str = "10/hour"
    # A full data export reads every table the mill has; a few an hour is plenty.
    # The backup file (services/data_backup.py) shares it.
    RATE_LIMIT_DATA_EXPORT: str = "3/hour"
    # Checking or restoring an uploaded backup reads the whole file, and a
    # restore rewrites every table: each route gets a few an hour.
    RATE_LIMIT_DATA_RESTORE: str = "5/hour"
    # The largest backup file accepted for upload. The Workers plan caps a
    # request body at 100 MB; a real mill's backup is a few MB.
    DATA_BACKUP_MAX_MB: int = 50
    # The oldest desktop app served (app/core/client_version.py); older builds get
    # 426 and are told to update. Empty: every version is served.
    DESKTOP_MIN_VERSION: str = ""
    # SMTP delivery for password-reset and verification links. Production
    # refuses to boot without it so live secrets never need to be logged.
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: SecretStr | None = None
    SMTP_FROM_EMAIL: str | None = None
    SMTP_STARTTLS: bool = True
    # The root key for data at rest: two-factor seeds, and the mills' backup
    # files (core/crypto.py). Never rotated: a new one leaves both unreadable.
    MFA_ENCRYPTION_KEY: SecretStr | None = None
    SIGNUP_INVITE_CODE: SecretStr | None = None
    # Anyone may create a mill, without the invite code. Production and the
    # preview then insist on Turnstile on the sign-up form (core/turnstile.py):
    # TURNSTILE_SECRET (a Worker secret), the public TURNSTILE_SITE_KEY the form
    # shows, and TURNSTILE_HOSTNAMES, the site's own hostnames, comma-separated.
    SIGNUP_OPEN: bool = False
    TURNSTILE_SECRET: SecretStr | None = None
    TURNSTILE_SITE_KEY: str | None = None
    TURNSTILE_HOSTNAMES: str = ""
    # Optional: the platform admin whose password lives in Cloudflare rather than
    # the database (core/platform_admin.py). A username and a bcrypt hash, made with
    # `create_platform_admin.py --hash`; both or neither. The email is optional.
    PLATFORM_ADMIN_USERNAME: str | None = None
    PLATFORM_ADMIN_PASSWORD_HASH: SecretStr | None = None
    PLATFORM_ADMIN_EMAIL: str | None = None
    # Optional Redis cache. When unset (or unreachable), the app runs without
    # caching and reads straight from PostgreSQL — Redis is never required.
    REDIS_URL: str | None = None
    # Optional: Upstash's developer API, read daily by the platform.redis_budget
    # job to warn platform admins at 70% and 90% of the month's request quota.
    # The stats API reports usage but not the plan's limit, so that's set here
    # (the free tier's 500K by default). Unset: the job does nothing.
    UPSTASH_API_EMAIL: str | None = None
    UPSTASH_API_KEY: SecretStr | None = None
    UPSTASH_DATABASE_ID: str | None = None
    UPSTASH_MONTHLY_REQUEST_LIMIT: int = 500_000

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.TRUSTED_HOSTS.split(",") if h.strip()] or ["*"]

    @property
    def is_prod(self) -> bool:
        """Production behaviour: the live service, and the private preview."""
        return self.ENV in ("prod", "preview")

    @property
    def is_preview(self) -> bool:
        return self.ENV == "preview"

    @property
    def email_required(self) -> bool:
        """Production refuses to work without email delivery; the preview may run without it."""
        return self.ENV == "prod"

    @property
    def mfa_required_role_names(self) -> set[str]:
        return {r.strip() for r in self.MFA_REQUIRED_ROLES.split(",") if r.strip()}

    @field_validator("SECRET_KEY")
    @classmethod
    def _reject_placeholder_secret(cls, v: str) -> str:
        """Always reject the shipped placeholder secret; warn on weak dev keys.

        Hard length/strength enforcement is deferred to the prod-only model
        validator so CI's throwaway key keeps working."""
        low = v.lower()
        if any(marker in low for marker in _PLACEHOLDER_SECRET_MARKERS):
            raise ValueError("SECRET_KEY is set to a placeholder value. Generate a real one with: openssl rand -hex 32")
        if len(v) < _MIN_SECRET_LEN:
            logger.warning(
                "SECRET_KEY is shorter than %d chars — acceptable for dev only. "
                "Set a 32+ char random key (openssl rand -hex 32) before deploying.",
                _MIN_SECRET_LEN,
            )
        return v

    @model_validator(mode="after")
    def _platform_admin_from_secrets(self) -> "Settings":
        """In every environment: a half-set or malformed Cloudflare admin would
        leave the platform with no way in, so refuse to boot instead."""
        name = (self.PLATFORM_ADMIN_USERNAME or "").strip() or None
        hashed = (
            self.PLATFORM_ADMIN_PASSWORD_HASH.get_secret_value().strip() if self.PLATFORM_ADMIN_PASSWORD_HASH else ""
        )
        self.PLATFORM_ADMIN_USERNAME = name
        self.PLATFORM_ADMIN_PASSWORD_HASH = SecretStr(hashed) if hashed else None
        self.PLATFORM_ADMIN_EMAIL = (self.PLATFORM_ADMIN_EMAIL or "").strip() or None
        if bool(name) != bool(hashed):
            raise ValueError(
                "PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD_HASH go together: set both or neither"
            )
        if name and len(name) > 50:
            raise ValueError("PLATFORM_ADMIN_USERNAME must be at most 50 characters")
        if hashed and not _BCRYPT_HASH.fullmatch(hashed):
            raise ValueError(
                "PLATFORM_ADMIN_PASSWORD_HASH must be a bcrypt hash (create_platform_admin.py --hash), "
                "never the password itself"
            )
        return self

    @model_validator(mode="after")
    def _fail_closed_in_prod(self) -> "Settings":
        """Refuse to boot with an insecure configuration when ENV=prod (or preview)."""
        if not self.is_prod:
            return self
        problems: list[str] = []
        if len(self.SECRET_KEY) < _MIN_SECRET_LEN:
            problems.append(f"SECRET_KEY must be at least {_MIN_SECRET_LEN} characters")
        if len(set(self.SECRET_KEY)) < 10:
            problems.append("SECRET_KEY appears low-entropy; use a cryptographically random value")
        if self.DEBUG:
            problems.append("DEBUG must be false (it exposes API docs and tracebacks)")
        if any(("localhost" in o or "127.0.0.1" in o) for o in self.origins_list):
            problems.append("ALLOWED_ORIGINS still contains localhost/127.0.0.1")
        if "*" in self.origins_list:
            problems.append("ALLOWED_ORIGINS must be an explicit HTTPS allowlist, not '*'")
        if any(not o.startswith("https://") for o in self.origins_list):
            problems.append("every ALLOWED_ORIGINS entry must use HTTPS")
        if "*" in self.trusted_hosts_list:
            problems.append("TRUSTED_HOSTS must be an explicit allowlist, not '*'")
        if not self.COOKIE_SECURE:
            problems.append("COOKIE_SECURE must be true so session cookies require HTTPS")
        if self.EXPOSE_RESET_TOKEN:
            problems.append("EXPOSE_RESET_TOKEN must be false (it leaks reset tokens in responses)")
        if not self.RATE_LIMIT_ENABLED:
            problems.append("RATE_LIMIT_ENABLED must be true")
        if not self.MFA_ENFORCE:
            problems.append("MFA_ENFORCE must be true")
        if not {"owner", "admin"}.issubset(self.mfa_required_role_names):
            problems.append("MFA_REQUIRED_ROLES must include owner and admin")
        # The preview may run without an email provider, and so without
        # verification (owner's decision, 2026-10-09); production may not.
        has_smtp = bool(self.SMTP_HOST and self.SMTP_FROM_EMAIL)
        if self.email_required and not has_smtp:
            problems.append("SMTP_HOST and SMTP_FROM_EMAIL are required for secure token delivery")
        if self.is_preview and self.REQUIRE_EMAIL_VERIFICATION and not has_smtp:
            problems.append("REQUIRE_EMAIL_VERIFICATION needs SMTP_HOST and SMTP_FROM_EMAIL to send the links")
        if self.MFA_ENCRYPTION_KEY is None or len(self.MFA_ENCRYPTION_KEY.get_secret_value()) < _MIN_SECRET_LEN:
            problems.append("MFA_ENCRYPTION_KEY must be a separate 32+ character secret")
        if self.SIGNUP_OPEN:
            # Open to anyone means open to bots, and every sign-up provisions a schema.
            if self.TURNSTILE_SECRET is None or not self.TURNSTILE_SITE_KEY:
                problems.append("SIGNUP_OPEN needs Turnstile: set TURNSTILE_SECRET and TURNSTILE_SITE_KEY")
            hostnames = [h.strip() for h in self.TURNSTILE_HOSTNAMES.split(",") if h.strip()]
            if not hostnames:
                problems.append("SIGNUP_OPEN needs TURNSTILE_HOSTNAMES, the site's hostnames")
            if any(h in ("localhost", "127.0.0.1") for h in hostnames):
                problems.append("TURNSTILE_HOSTNAMES must not include localhost in production")
        elif self.SIGNUP_INVITE_CODE is None or len(self.SIGNUP_INVITE_CODE.get_secret_value()) < 16:
            problems.append("SIGNUP_INVITE_CODE must be a 16+ character secret")
        if self.email_required and not self.REQUIRE_EMAIL_VERIFICATION:
            problems.append("REQUIRE_EMAIL_VERIFICATION must be true")
        if not self.PASSWORD_BREACH_CHECK:
            problems.append("PASSWORD_BREACH_CHECK must be true")
        if not self.FRONTEND_BASE_URL.startswith("https://"):
            problems.append("FRONTEND_BASE_URL must use HTTPS")
        if not self.REDIS_URL:
            problems.append("REDIS_URL is required for shared rate-limit and lockout state")
        elif not self.REDIS_URL.startswith("rediss://"):
            problems.append("REDIS_URL must use TLS (rediss://) in production")
        if (
            "localhost" not in self.DATABASE_URL
            and "127.0.0.1" not in self.DATABASE_URL
            and "sslmode=" not in self.DATABASE_URL
        ):
            problems.append("DATABASE_URL must require TLS with sslmode=require or stricter")
        if self.PROCESS_ROLE == "api" and self.PROVISIONER_DATABASE_URL is not None:
            problems.append("PROVISIONER_DATABASE_URL must not be exposed to the long-running API process")
        if self.PROCESS_ROLE == "jobs" and self.PROVISIONER_DATABASE_URL is not None:
            problems.append("PROVISIONER_DATABASE_URL must not be exposed to the jobs process; it runs with DML only")
        if self.PROCESS_ROLE == "provisioner" and self.PROVISIONER_DATABASE_URL is None:
            problems.append("PROVISIONER_DATABASE_URL is required by the provisioning process")
        if self.PROVISIONER_DATABASE_URL is not None:
            provisioner_url = self.PROVISIONER_DATABASE_URL.get_secret_value()
            if provisioner_url == self.DATABASE_URL:
                problems.append("DATABASE_URL and PROVISIONER_DATABASE_URL must use different roles")
            if (
                "localhost" not in provisioner_url
                and "127.0.0.1" not in provisioner_url
                and "sslmode=" not in provisioner_url
            ):
                problems.append("PROVISIONER_DATABASE_URL must require TLS")
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", self.RUNTIME_DATABASE_ROLE):
            problems.append("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL role name")
        if self.RUNTIME_DATABASE_ROLE in {"postgres", "rds_superuser"}:
            problems.append("RUNTIME_DATABASE_ROLE must not be an administrative role")
        # Published agreements with unfilled placeholders are worse than none:
        # a Terms of Service naming no legal entity and no venue invites the
        # argument that no contract was formed at all. Imported lazily so a
        # missing legal/ directory cannot break non-prod boot. The private
        # preview is a beta for invited testers, and shows them "To follow".
        if not self.is_preview:
            try:
                from .legal import unresolved_placeholders

                problems.extend(f"legal document placeholder unfilled: {p}" for p in unresolved_placeholders())
            except Exception as exc:  # pragma: no cover - defensive
                problems.append(f"legal documents could not be validated: {exc}")
        if problems:
            raise ValueError(f"Insecure production configuration (ENV={self.ENV}): " + "; ".join(problems))
        return self

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
