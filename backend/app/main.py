import asyncio
import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .core.config import settings
from .core.exceptions import register_exception_handlers
from .core.middleware import SecurityHeadersMiddleware
from .core.ratelimit import limiter, rate_limit_exceeded_handler
from .core.security import enforce_mfa_enrollment
from .api import auth, users, branches, paddy, milling, inventory, sales, costs, reports, sync, admin, employees, billing, canva, dispatch, weather, locations, activity, fleet
from .services.canva_realtime import manager as ws_manager

logger = logging.getLogger(__name__)


async def _purge_stale_varieties() -> None:
    """Background loop: delete tenant rice varieties deactivated >30 days ago."""
    from .core.database import SessionLocal
    from .services.paddy_service import purge_stale_varieties

    while True:
        await asyncio.sleep(86400)  # wait 24 h before first run, then repeat
        try:
            db = SessionLocal()
            try:
                count = purge_stale_varieties(db)
                db.commit()
                if count:
                    logger.info("Purged %d stale rice variety rows (deactivated >30 days)", count)
            finally:
                db.close()
        except Exception:
            logger.exception("Error during stale variety purge")

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
# Reject unexpected Host headers (prod sets an explicit allowlist; dev allows "*").
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list)
# CORS outermost: answers preflight and attaches CORS headers to every response,
# including ones short-circuited by an inner middleware.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Map domain exceptions (app.core.exceptions) to HTTP responses, plus the 429
# from the rate limiter. Additive — existing `raise HTTPException(...)` sites
# are unchanged.
register_exception_handlers(app)
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# The /auth router and the WebSocket router are NOT MFA-gated: a privileged user
# pending enrollment must still reach /auth (me, logout, mfa/enroll). Every other
# (data) router is gated — the dependency 403s until enrollment completes.
mfa_gate = [Depends(enforce_mfa_enrollment)]

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
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
app.include_router(locations.router, prefix="/api", tags=["Saved Locations"], dependencies=mfa_gate)
app.include_router(activity.router, prefix="/api/activity", tags=["Activity Log"], dependencies=mfa_gate)
app.include_router(fleet.router, prefix="/api", tags=["Fleet"], dependencies=mfa_gate)


@app.on_event("startup")
async def _capture_loop_for_canva_broadcasts() -> None:
    """Give the canva WS manager a handle to the main event loop so sync
    PATCH handlers can schedule broadcasts onto it."""
    ws_manager.set_main_loop(asyncio.get_running_loop())
    asyncio.create_task(_purge_stale_varieties())


@app.on_event("startup")
async def _probe_cache() -> None:
    """Surface Redis connectivity at boot (best-effort — never blocks startup)."""
    from .core.cache import cache
    cache.available()


@app.get("/api/health")
def health_check():
    from .core.cache import cache
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "cache": "up" if cache.available() else "down",
    }
