import asyncio
import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .api import (
    activity,
    admin,
    auth,
    automations,
    billing,
    branches,
    canva,
    costs,
    dispatch,
    drying_advisor,
    employees,
    fleet,
    inventory,
    legal,
    locations,
    milling,
    notifications,
    paddy,
    reports,
    sales,
    sync,
    users,
    weather,
)
from .core.config import settings
from .core.exceptions import register_exception_handlers
from .core.logging_config import configure_logging
from .core.middleware import MutationAuditMiddleware, SecurityHeadersMiddleware
from .core.ratelimit import limiter, rate_limit_exceeded_handler
from .core.security import (
    enforce_email_verified,
    enforce_mfa_enrollment,
    enforce_tenant_provisioned,
)
from .services.canva_realtime import manager as ws_manager

# JSON lines in production, readable text in development; tests leave logging
# to pytest. Scheduled work (such as the stale-variety purge that used to run
# as a loop in here) lives in app/jobs, run by its own container.
if settings.ENV != "test":
    configure_logging(json_output=settings.is_prod)

logger = logging.getLogger(__name__)


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
)

# ── Middleware (each add_middleware wraps the previous; the LAST call is the
# outermost layer that runs first on a request). ──────────────────────────────
# slowapi's route decorators require the limiter on app.state.
app.state.limiter = limiter
# Global per-IP throttle (innermost). No-op when rate limiting is disabled.
app.add_middleware(SlowAPIMiddleware)
# Hardening headers on every response.
app.add_middleware(SecurityHeadersMiddleware)
# Structured + durable audit coverage for every mutating API request.
app.add_middleware(MutationAuditMiddleware)
# Reject unexpected Host headers (prod sets an explicit allowlist; dev allows "*").
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list)
# CORS outermost: answers preflight and attaches CORS headers to every response,
# including ones short-circuited by an inner middleware.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-CSRF-Token",
        "X-Client-Type",
    ],
)

# Map domain exceptions (app.core.exceptions) to HTTP responses, plus the 429
# from the rate limiter. Additive — existing `raise HTTPException(...)` sites
# are unchanged.
register_exception_handlers(app)
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# The /auth router and the WebSocket router are NOT gated: a user pending MFA
# enrollment or email verification must still reach /auth (me, logout, mfa/enroll,
# verify-email). Every other (data) router is gated — the dependencies 403 until
# the account is ready (both are no-ops unless their enforcement flag is on).
mfa_gate = [
    Depends(enforce_mfa_enrollment),
    Depends(enforce_email_verified),
    Depends(enforce_tenant_provisioned),
]

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
# Legal documents are public by design: terms nobody could read before
# agreeing are weak terms. Acceptance endpoints inside still require auth.
app.include_router(legal.router, prefix="/api/legal", tags=["Legal"])
app.include_router(users.router, prefix="/api/users", tags=["Users"], dependencies=mfa_gate)
app.include_router(branches.router, prefix="/api/branches", tags=["Branches"], dependencies=mfa_gate)
app.include_router(paddy.router, prefix="/api/paddy", tags=["Paddy"], dependencies=mfa_gate)
app.include_router(milling.router, prefix="/api/milling", tags=["Milling"], dependencies=mfa_gate)
app.include_router(inventory.router, prefix="/api/inventory", tags=["Inventory"], dependencies=mfa_gate)
app.include_router(sales.router, prefix="/api/sales", tags=["Sales"], dependencies=mfa_gate)
app.include_router(costs.router, prefix="/api/costs", tags=["Costs"], dependencies=mfa_gate)
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"], dependencies=mfa_gate)
app.include_router(sync.router, prefix="/api/sync", tags=["Sync"], dependencies=mfa_gate)
app.include_router(admin.router, prefix="/api/admin", tags=["Platform Admin"], dependencies=mfa_gate)
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"], dependencies=mfa_gate)
app.include_router(billing.router, prefix="/api/billing", tags=["Billing"], dependencies=mfa_gate)
app.include_router(canva.router, prefix="/api", tags=["Warehouse Canva"], dependencies=mfa_gate)
app.include_router(canva.ws_router, tags=["Warehouse Canva (Realtime)"])
app.include_router(dispatch.router, prefix="/api", tags=["Dispatch"], dependencies=mfa_gate)
app.include_router(weather.router, prefix="/api", tags=["Weather"], dependencies=mfa_gate)
app.include_router(drying_advisor.router, prefix="/api", tags=["Drying Advisor"], dependencies=mfa_gate)
app.include_router(locations.router, prefix="/api", tags=["Saved Locations"], dependencies=mfa_gate)
app.include_router(activity.router, prefix="/api/activity", tags=["Activity Log"], dependencies=mfa_gate)
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"], dependencies=mfa_gate)
app.include_router(automations.router, prefix="/api/automations", tags=["Automations"], dependencies=mfa_gate)
app.include_router(fleet.router, prefix="/api", tags=["Fleet"], dependencies=mfa_gate)


@app.on_event("startup")
async def _capture_loop_for_canva_broadcasts() -> None:
    """Give the canva WS manager a handle to the main event loop so sync
    PATCH handlers can schedule broadcasts onto it."""
    ws_manager.set_main_loop(asyncio.get_running_loop())


@app.on_event("startup")
async def _probe_cache() -> None:
    """Surface Redis connectivity at boot (best-effort — never blocks startup)."""
    from .core.cache import cache

    cache.available()


@app.on_event("startup")
async def _verify_runtime_database_role() -> None:
    """Fail production startup if the API accidentally runs with DDL power."""
    if not settings.is_prod:
        return
    from .core.database import engine
    from .core.runtime_role import verify_runtime_database_role

    verify_runtime_database_role(engine, settings.RUNTIME_DATABASE_ROLE)


@app.get("/api/health")
@limiter.exempt
def health_check():
    from .core.cache import cache

    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "cache": "up" if cache.available() else "down",
    }
