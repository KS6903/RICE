import logging
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


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: Literal["HS256"] = "HS256"
    JWT_ISSUER: str = "oryza-api"
    JWT_AUDIENCE: str = "oryza-clients"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # "Remember this device" for MFA: after a successful TOTP/backup-code verify,
    # this device skips the MFA step on login until the next weekly reset — the
    # upcoming Sunday 00:00 in the local timezone below — so every device
    # re-prompts on Sunday. Set MFA_TRUST_ENABLED=false for MFA on every login.
    MFA_TRUST_ENABLED: bool = True
    MFA_TRUST_RESET_UTC_OFFSET_HOURS: int = 8  # Asia/Manila (PH has no DST)
    ALLOWED_ORIGINS: str = "http://localhost:8448,http://localhost:3000"
    APP_NAME: str = "Oryza by K Systematics"
    DEBUG: bool = False
    # Deployment environment. "prod" turns on fail-closed config checks (see the
    # model validator below) and enables HSTS. Leave as "dev" locally / in CI.
    # Closed enum: a typo such as ENV=production must fail validation instead
    # of silently selecting insecure development behavior.
    ENV: Literal["dev", "test", "prod"] = "dev"
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
    LOGIN_MAX_FAILURES: int = 5            # attempts allowed in the first round
    LOGIN_MIN_FAILURES: int = 2            # floor — threshold never drops below this
    LOGIN_LOCKOUT_WINDOW_SECONDS: int = 900   # window failures are counted within
    LOGIN_LOCKOUT_BASE_SECONDS: int = 60      # first lockout duration
    LOGIN_LOCKOUT_FACTOR: int = 5             # each round multiplies the duration
    LOGIN_LOCKOUT_MAX_SECONDS: int = 86400    # cap on any single lockout (24h)
    LOGIN_LOCKOUT_MAX_ROUNDS: int = 5         # lockouts before a permanent block
    # How long the escalation memory (round counter) and the permanent block live in
    # Redis. The round counter decays so an honest user who later mistypes once isn't
    # treated as a serial offender; the permanent flag is effectively durable.
    LOGIN_LOCKOUT_ROUND_TTL_SECONDS: int = 86400        # 1 day
    LOGIN_LOCKOUT_PERMANENT_TTL_SECONDS: int = 2592000  # 30 days
    # MFA enforcement. When on, accounts in MFA_REQUIRED_ROLES (plus all platform
    # admins) must enroll in TOTP before they can use the app — the API blocks
    # data endpoints until they do. Disabled in tests via env.
    MFA_ENFORCE: bool = True
    MFA_REQUIRED_ROLES: str = "owner,admin"
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
    # SMTP delivery for password-reset and verification links. Production
    # refuses to boot without it so live secrets never need to be logged.
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: SecretStr | None = None
    SMTP_FROM_EMAIL: str | None = None
    SMTP_STARTTLS: bool = True
    MFA_ENCRYPTION_KEY: SecretStr | None = None
    SIGNUP_INVITE_CODE: SecretStr | None = None
    # Optional Redis cache. When unset (or unreachable), the app runs without
    # caching and reads straight from PostgreSQL — Redis is never required.
    REDIS_URL: str | None = None

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.TRUSTED_HOSTS.split(",") if h.strip()] or ["*"]

    @property
    def is_prod(self) -> bool:
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
            raise ValueError(
                "SECRET_KEY is set to a placeholder value. Generate a real one with: "
                "openssl rand -hex 32"
            )
        if len(v) < _MIN_SECRET_LEN:
            logger.warning(
                "SECRET_KEY is shorter than %d chars — acceptable for dev only. "
                "Set a 32+ char random key (openssl rand -hex 32) before deploying.",
                _MIN_SECRET_LEN,
            )
        return v

    @model_validator(mode="after")
    def _fail_closed_in_prod(self) -> "Settings":
        """Refuse to boot with an insecure configuration when ENV=prod."""
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
        if not self.SMTP_HOST or not self.SMTP_FROM_EMAIL:
            problems.append("SMTP_HOST and SMTP_FROM_EMAIL are required for secure token delivery")
        if (
            self.MFA_ENCRYPTION_KEY is None
            or len(self.MFA_ENCRYPTION_KEY.get_secret_value()) < _MIN_SECRET_LEN
        ):
            problems.append("MFA_ENCRYPTION_KEY must be a separate 32+ character secret")
        if (
            self.SIGNUP_INVITE_CODE is None
            or len(self.SIGNUP_INVITE_CODE.get_secret_value()) < 16
        ):
            problems.append("SIGNUP_INVITE_CODE must be a 16+ character secret")
        if not self.REQUIRE_EMAIL_VERIFICATION:
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
        if problems:
            raise ValueError(
                "Insecure production configuration (ENV=prod): " + "; ".join(problems)
            )
        return self

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
