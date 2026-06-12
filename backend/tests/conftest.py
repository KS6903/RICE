"""Pytest fixtures for the RICE backend.

Part of Phase 0 (safety scaffolding) of the OOP-standardization refactor. These
fixtures stand up a *dedicated test Postgres database* and give every test an
isolated, auto-rolled-back session plus a TestClient. Nothing here touches the
real "Rice Mill System" database or runtime code paths.

Why a real Postgres (not SQLite): the models use PG-specific types (UUID, JSONB),
so SQLite would not be a faithful substitute. We point the app at a sibling
database named "<db> Test", build the schema from the ORM models, and seed the
minimal reference rows the API needs (roles, a feature-complete plan, a company,
a main branch, an owner user).

Isolation: each test runs inside an outer transaction with
``join_transaction_mode="create_savepoint"`` — the app's own ``db.commit()``
calls are contained in savepoints and the whole thing is rolled back at the end
of the test, so the test DB stays clean and tests never see each other's writes.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Environment: do this BEFORE importing anything under app.* so the app's
# Settings (and its engine) bind to the test database and run cache-free.
# ---------------------------------------------------------------------------
_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")  # populate os.environ from .env (no override)

_PROD_DATABASE_URL = os.environ["DATABASE_URL"]


def _derive_test_url(url: str) -> str:
    """Return the URL of a sibling test database named "<db> Test"."""
    parsed = urlparse(url)
    db_name = parsed.path.lstrip("/")
    test_db = f"{db_name} Test"
    return urlunparse(parsed._replace(path="/" + test_db))


_TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or _derive_test_url(_PROD_DATABASE_URL)

# Point the app at the test DB and disable Redis (deterministic, cache-free runs).
os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
os.environ["REDIS_URL"] = ""
# Disable rate limiting so the suite (which reuses one TestClient IP and hits the
# auth endpoints many times) is deterministic. Rate-limit behaviour is covered by
# its own dedicated test that re-enables it.
os.environ["RATE_LIMIT_ENABLED"] = "false"
# Disable MFA enforcement by default: the seeded owner/admin users aren't enrolled,
# and enforcement would 403 them out of every data endpoint. The enforcement path
# has its own dedicated test that re-enables it.
os.environ["MFA_ENFORCE"] = "false"


def _ensure_test_database_exists() -> None:
    """Create the test database if it does not already exist."""
    parsed = urlparse(_TEST_DATABASE_URL)
    test_db = parsed.path.lstrip("/")
    admin = psycopg.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=parsed.username,
        password=parsed.password,
        dbname="postgres",
        autocommit=True,
    )
    try:
        exists = admin.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (test_db,)
        ).fetchone()
        if not exists:
            # Identifier can't be parametrized; quote it ourselves (it's derived
            # from our own .env, not user input).
            admin.execute(f'CREATE DATABASE "{test_db}"')
    finally:
        admin.close()


_ensure_test_database_exists()

# Now it's safe to import the app — Settings reads the overridden env.
import app.models  # noqa: E402,F401  — register every table on Base.metadata
from app.core.database import Base, engine, get_db  # noqa: E402
from app.core.security import get_current_user, hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models.company import Branch, Company  # noqa: E402
from app.models.subscription import Subscription, SubscriptionPlan  # noqa: E402
from app.models.user import Role, User  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

# Every feature code gated by require_feature() in the API, so a seeded owner can
# reach every router during characterization.
ALL_FEATURES = [
    "paddy", "milling", "inventory", "sales", "expenses",
    "employees", "users", "canva_inventory",
    "reports_advanced", "compliance_reports",
]


@pytest.fixture(scope="session", autouse=True)
def _schema() -> None:
    """Build the test schema once per session from the ORM models."""
    Base.metadata.create_all(bind=engine)
    yield
    # Leave the schema in place between runs (faster reruns; data is rolled back
    # per-test anyway). Drop explicitly with a fresh DB if a model changes.


@pytest.fixture
def db_session() -> Session:
    """An isolated session whose writes (including app commits) are rolled back."""
    connection = engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


@pytest.fixture
def client(db_session: Session) -> TestClient:
    """TestClient whose get_db yields the isolated test session.

    Auth is NOT overridden here — use this for real login/token/401 tests.
    """
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        # Plain TestClient (no context manager) so startup events (canva loop
        # capture, Redis probe) don't fire — tests don't need them.
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def seed_owner(db_session: Session) -> User:
    """Seed roles + a feature-complete plan + company + main branch + owner user.

    Returns the owner User. Password for login tests is "Password123".
    """
    owner_role = Role(id=1, name="owner")
    admin_role = Role(id=2, name="admin")
    db_session.add_all([owner_role, admin_role])
    db_session.flush()

    plan = SubscriptionPlan(code="test", name="Test Plan", features=list(ALL_FEATURES))
    db_session.add(plan)
    db_session.flush()

    company = Company(name="Test Mill", is_multi_branch=False)
    db_session.add(company)
    db_session.flush()

    branch = Branch(company_id=company.id, name="Main Branch", is_main_branch=True)
    db_session.add(branch)
    db_session.flush()

    db_session.add(Subscription(company_id=company.id, plan_id=plan.id, status="active"))

    user = User(
        company_id=company.id,
        branch_id=branch.id,
        username="owner",
        email="owner@test.local",
        password_hash=hash_password("Password123"),
        full_name="Test Owner",
        role_id=owner_role.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture
def auth_client(client: TestClient, seed_owner: User) -> TestClient:
    """TestClient authenticated as the seeded owner (get_current_user overridden).

    Use this for endpoints behind auth/feature/role gates. The override applies to
    nested uses of get_current_user too (e.g. inside require_feature/require_roles).
    """
    app.dependency_overrides[get_current_user] = lambda: seed_owner
    try:
        yield client
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def admin_client(make_auth_client) -> TestClient:
    """TestClient authenticated as a platform admin (is_platform_admin=True).

    Its seeded company also gives the /admin/tenants endpoints a tenant to act on.
    """
    return make_auth_client(features=[], username="admin", is_platform_admin=True)


@pytest.fixture
def make_auth_client(client: TestClient, db_session: Session):
    """Factory: a TestClient authed as a fresh user with a chosen plan + role.

    Lets a test stand up a user whose plan *lacks* a feature (to characterize the
    402 gate) or who has a non-owner role. Usage:

        c = make_auth_client(features=["inventory"], username="basic")
        c.get("/api/paddy/varieties")  # -> 402, paddy not in plan
    """
    _role_ids: dict[str, int] = {}
    _n = {"i": 0}

    def _ensure_role(name: str) -> int:
        if name not in _role_ids:
            rid = len(_role_ids) + 1
            db_session.add(Role(id=rid, name=name))
            db_session.flush()
            _role_ids[name] = rid
        return _role_ids[name]

    def _make(features, *, username: str = "user", role_name: str = "owner",
              is_platform_admin: bool = False) -> TestClient:
        role_id = _ensure_role(role_name)
        _n["i"] += 1
        suffix = f"{username}{_n['i']}"
        plan = SubscriptionPlan(code=f"plan-{suffix}", name="Plan", features=list(features))
        company = Company(name=f"Co {suffix}")
        db_session.add_all([plan, company])
        db_session.flush()
        branch = Branch(company_id=company.id, name="Main", is_main_branch=True)
        db_session.add(branch)
        db_session.flush()
        db_session.add(Subscription(company_id=company.id, plan_id=plan.id, status="active"))
        user = User(
            company_id=company.id, branch_id=branch.id, username=suffix,
            email=f"{suffix}@test.local", password_hash=hash_password("Password123"),
            full_name="Test User", role_id=role_id, is_active=True,
            is_platform_admin=is_platform_admin,
        )
        db_session.add(user)
        db_session.flush()
        app.dependency_overrides[get_current_user] = lambda: user
        return client

    try:
        yield _make
    finally:
        app.dependency_overrides.pop(get_current_user, None)
