import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .core.exceptions import register_exception_handlers
from .api import auth, users, branches, paddy, milling, inventory, sales, costs, reports, sync, admin, employees, billing, canva, dispatch, weather, locations, activity, fleet
from .services.canva_realtime import manager as ws_manager

logger = logging.getLogger(__name__)


async def _purge_stale_varieties() -> None:
    """Delete tenant rice varieties deactivated for more than 30 days.

    Runs once at startup then every 24 hours. System varieties (company_id IS
    NULL) are never deleted — only tenant-owned rows qualify.
    """
    from sqlalchemy import delete
    from .core.database import SessionLocal
    from .models.reference import RiceVariety

    while True:
        await asyncio.sleep(86400)  # wait 24 h before first run, then repeat
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        try:
            db = SessionLocal()
            try:
                result = db.execute(
                    delete(RiceVariety).where(
                        RiceVariety.is_active.is_(False),
                        RiceVariety.deactivated_at <= cutoff,
                        RiceVariety.company_id.is_not(None),
                    )
                )
                db.commit()
                if result.rowcount:  # type: ignore[attr-defined]
                    logger.info("Purged %d stale rice variety rows (deactivated >30 days)", result.rowcount)  # type: ignore[attr-defined]
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Map domain exceptions (app.core.exceptions) to HTTP responses. Additive — the
# many existing `raise HTTPException(...)` sites are unchanged.
register_exception_handlers(app)

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(branches.router, prefix="/api/branches", tags=["Branches"])
app.include_router(paddy.router, prefix="/api/paddy", tags=["Paddy"])
app.include_router(milling.router, prefix="/api/milling", tags=["Milling"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["Inventory"])
app.include_router(sales.router, prefix="/api/sales", tags=["Sales"])
app.include_router(costs.router, prefix="/api/costs", tags=["Costs"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(sync.router, prefix="/api/sync", tags=["Sync"])
app.include_router(admin.router, prefix="/api/admin", tags=["Platform Admin"])
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
app.include_router(billing.router, prefix="/api/billing", tags=["Billing"])
app.include_router(canva.router, prefix="/api", tags=["Warehouse Canva"])
app.include_router(canva.ws_router, tags=["Warehouse Canva (Realtime)"])
app.include_router(dispatch.router, prefix="/api", tags=["Dispatch"])
app.include_router(weather.router, prefix="/api", tags=["Weather"])
app.include_router(locations.router, prefix="/api", tags=["Saved Locations"])
app.include_router(activity.router, prefix="/api/activity", tags=["Activity Log"])
app.include_router(fleet.router, prefix="/api", tags=["Fleet"])


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
