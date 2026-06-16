import logging
from functools import lru_cache

from pydantic import field_validator, model_validator
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
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # "Remember this device" for MFA: after a successful TOTP/backup-code verify,
    # this device skips the MFA step on login until the next weekly reset — the
    # upcoming Sunday 00:00 in the local timezone below — so every device
    # re-prompts on Sunday. Set MFA_TRUST_ENABLED=false for MFA on every login.
    MFA_TRUST_ENABLED: bool = True
    MFA_TRUST_RESET_UTC_OFFSET_HOURS: int = 8  # Asia/Manila (PH has no DST)
    ALLOWED_ORIGINS: str = "http://localhost:8448,http://localhost:3000"
    APP_NAME: str = "Rice Mill System"
    DEBUG: bool = False
    # Deployment environment. "prod" turns on fail-closed config checks (see the
    # model validator below) and enables HSTS. Leave as "dev" locally / in CI.
    ENV: str = "dev"
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
    # Account lockout: after N failed logins for a username, lock it for M seconds.
    # Backed by Redis; a no-op when Redis is unavailable (per-IP limit still holds).
    LOGIN_MAX_FAILURES: int = 5
    LOGIN_LOCKOUT_SECONDS: int = 900
    # MFA enforcement. When on, accounts in MFA_REQUIRED_ROLES (plus all platform
    # admins) must enroll in TOTP before they can use the app — the API blocks
    # data endpoints until they do. Disabled in tests via env.
    MFA_ENFORCE: bool = True
    MFA_REQUIRED_ROLES: str = "owner"
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
        return self.ENV.strip().lower() == "prod"

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
        if self.DEBUG:
            problems.append("DEBUG must be false (it exposes API docs and tracebacks)")
        if any(("localhost" in o or "127.0.0.1" in o) for o in self.origins_list):
            problems.append("ALLOWED_ORIGINS still contains localhost/127.0.0.1")
        if "*" in self.trusted_hosts_list:
            problems.append("TRUSTED_HOSTS must be an explicit allowlist, not '*'")
        if not self.COOKIE_SECURE:
            problems.append("COOKIE_SECURE must be true so session cookies require HTTPS")
        if self.EXPOSE_RESET_TOKEN:
            problems.append("EXPOSE_RESET_TOKEN must be false (it leaks reset tokens in responses)")
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
