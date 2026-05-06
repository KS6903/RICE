from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .api import auth, users, branches, paddy, milling, inventory, sales, costs, reports, sync, admin, employees

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


@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": settings.APP_NAME}
