"""Reset, seed, and serve an explicitly disposable end-to-end database.

The target database name must contain ``e2e``. This guard prevents Playwright
from ever starting against the normal development or production database.
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import uvicorn
from psycopg import sql

BACKEND_DIR = Path(__file__).resolve().parent
ALL_FEATURES = [
    "paddy",
    "milling",
    "inventory",
    "sales",
    "expenses",
    "employees",
    "users",
    "canva_inventory",
    "reports_advanced",
    "compliance_reports",
    "drying_advisor",
    "offline_sync",
]


def _validated_target() -> tuple[str, str]:
    url = os.environ.get("E2E_DATABASE_URL", "").strip()
    if not url:
        raise SystemExit("E2E_DATABASE_URL is required")
    parsed = urlparse(url)
    db_name = parsed.path.lstrip("/")
    if (
        parsed.scheme not in {"postgres", "postgresql"}
        or not parsed.hostname
        or not db_name
        or "e2e" not in db_name.lower()
        or db_name.lower() in {"postgres", "template0", "template1"}
        or re.fullmatch(r"[A-Za-z0-9 _-]+", db_name) is None
    ):
        raise SystemExit("Refusing database reset: use a PostgreSQL database whose safe name contains 'e2e'")
    maintenance_url = urlunparse(parsed._replace(path="/postgres"))
    return url, maintenance_url


def _reset_database(url: str, maintenance_url: str) -> None:
    db_name = urlparse(url).path.lstrip("/")
    with psycopg.connect(maintenance_url, autocommit=True) as connection:
        connection.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " "WHERE datname = %s AND pid <> pg_backend_pid()",
            (db_name,),
        )
        connection.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(db_name)))
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))


def _configure_environment(url: str) -> None:
    os.environ["DATABASE_URL"] = url
    os.environ["ENV"] = "test"
    os.environ["DEBUG"] = "false"
    os.environ["REDIS_URL"] = ""
    os.environ["RATE_LIMIT_ENABLED"] = "false"
    os.environ["MFA_ENFORCE"] = "false"
    os.environ["REQUIRE_EMAIL_VERIFICATION"] = "false"
    os.environ["EXPOSE_RESET_TOKEN"] = "false"
    os.environ.pop("PROVISIONER_DATABASE_URL", None)


def _migrate() -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        check=True,
    )


def _seed_accounts() -> None:
    import app.models  # noqa: F401
    from app.core.database import SessionLocal
    from app.core.security import hash_password
    from app.core.tenancy import provision_tenant, set_search_path
    from app.models.company import Branch, Company
    from app.models.subscription import Subscription, SubscriptionPlan
    from app.models.user import Role, User
    from seed import seed

    seed()
    with SessionLocal() as db:
        owner_role = db.query(Role).filter(Role.name == "owner").one()
        plan = SubscriptionPlan(
            code="e2e",
            name="E2E Plan",
            features=ALL_FEATURES,
            max_users=None,
            max_branches=None,
        )
        company = Company(name="Disposable E2E Mill")
        db.add_all([plan, company])
        db.flush()
        provision_tenant(company, db=db)
        set_search_path(db, company.schema_name)

        branch = Branch(company_id=company.id, name="Main Branch", is_main_branch=True)
        db.add(branch)
        db.flush()
        db.add(Subscription(company_id=company.id, plan_id=plan.id, status="active"))
        db.add(
            User(
                company_id=company.id,
                branch_id=branch.id,
                username="mill1",
                email="mill1@e2e.invalid",
                email_verified=True,
                password_hash=hash_password("password123"),
                full_name="E2E Mill Owner",
                role_id=owner_role.id,
                is_active=True,
            )
        )
        db.add(
            User(
                username="admin",
                email="admin@e2e.invalid",
                email_verified=True,
                password_hash=hash_password("admin1234"),
                full_name="E2E Platform Admin",
                is_active=True,
                is_platform_admin=True,
            )
        )
        db.commit()


def _seed_offline_weather() -> None:
    """Keep the E2E contract deterministic and independent of public APIs."""
    import time
    from datetime import datetime, timezone

    from app.services.weather import WeatherService

    payload = {
        "provider": "e2e-fixture",
        "temp_c": 30.0,
        "feels_like_c": 33.0,
        "humidity_pct": 70,
        "wind_kph": 8.0,
        "condition": "Partly cloudy",
        "condition_code": "partly_cloudy",
        "is_daytime": True,
        "location": {"lat": 14.6, "lon": 121.0, "label": None},
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    WeatherService._CACHE[(14.6, 121.0)] = (time.time() + 3600, payload)


def _build_e2e_app():
    """Add a test-only shutdown hook so Playwright can clean up on Windows."""
    from app.main import app

    @app.post("/__e2e_shutdown", include_in_schema=False)
    async def shutdown_e2e_server():
        threading.Timer(0.2, lambda: os.kill(os.getpid(), signal.SIGINT)).start()
        return {"message": "shutting down"}

    return app


def main() -> None:
    url, maintenance_url = _validated_target()
    _configure_environment(url)
    _reset_database(url, maintenance_url)
    _migrate()
    _seed_accounts()
    _seed_offline_weather()
    uvicorn.run(_build_e2e_app(), host="127.0.0.1", port=8001, access_log=False)


if __name__ == "__main__":
    main()
