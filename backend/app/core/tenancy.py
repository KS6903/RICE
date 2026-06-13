"""Schema-per-client multi-tenancy plumbing.

RICE runs every client (company) in its own PostgreSQL **schema** inside one shared
database. The shared ``public`` schema holds identity + the control plane
(companies, users, roles, subscriptions, …); each client gets a ``client_<hex>``
schema holding all of its domain data (paddy, milling, sales, warehouse, …).

A request resolves its client from the JWT (the ``schema`` claim) and runs against
that client's schema via ``SET search_path TO "<schema>", public`` — so unqualified
domain tables resolve to the client schema while shared identity/control-plane
tables fall back to ``public``.

The client→location mapping is **data-driven** (stored on the ``companies`` row):
today every client is a schema in the shared engine; setting ``Company.db_url``
later relocates a single client onto its own database/server with *no application
code change* (see :func:`engine_for`). That is the escalation path for
noisy-neighbor isolation / per-client portability.

Design note: ``company_id`` columns are retained on every domain table. Inside a
single-client schema those filters are harmless constants — keeping them means the
existing repository/service logic (and ~440 ``company_id`` references) works
unchanged. The *schema* is the real isolation boundary.
"""
from __future__ import annotations

import logging
import re
from contextlib import contextmanager
from typing import Iterator

import jwt
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from .config import settings
from .cookies import ACCESS_COOKIE
from .database import Base, SessionLocal, engine

logger = logging.getLogger("ricemill.tenancy")

# Tables that live in the shared ``public`` schema (identity + control plane).
# EVERYTHING ELSE registered on the model metadata is per-client domain data, so
# new domain tables become tenant-scoped automatically (fail-safe default).
PUBLIC_TABLE_NAMES: frozenset[str] = frozenset(
    {
        "companies",
        "branches",
        "users",
        "roles",
        "auth_sessions",
        "password_reset_tokens",
        "subscription_plans",
        "subscriptions",
        "subscription_upgrade_requests",
        "byproduct_types",  # global byproduct catalog (no company_id)
        "user_locations",   # per-user UI state (FK -> users only)
    }
)

# Postgres identifier rules we enforce before ever interpolating a schema name
# into DDL/SET (schema names can't be bound parameters). Server-generated names
# always match; this guards against anything unexpected reaching SQL.
_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def valid_schema_name(name: str | None) -> bool:
    return bool(name) and len(name) <= 63 and _SCHEMA_RE.fullmatch(name) is not None


def schema_name_for(company) -> str:
    """The schema a company's data lives in (auto-populated on insert)."""
    return company.schema_name


# ── table classification ──────────────────────────────────────────────────────


def tenant_tables() -> list:
    """Model Table objects that belong in each per-client schema.

    Uses the unsorted table map (not ``sorted_tables``) to avoid the harmless
    branches↔users cycle warning; ``create_all`` orders them itself.
    """
    return [t for t in Base.metadata.tables.values() if t.name not in PUBLIC_TABLE_NAMES]


def public_tables() -> list:
    """Model Table objects that belong in the shared ``public`` schema."""
    return [t for t in Base.metadata.tables.values() if t.name in PUBLIC_TABLE_NAMES]


# ── search_path control ───────────────────────────────────────────────────────


def set_search_path(db: Session, schema_name: str | None) -> None:
    """Point a session at a client schema (or back to ``public`` only).

    Idempotent and called at the start of every request, so a pooled connection
    never leaks a previous request's schema.
    """
    if valid_schema_name(schema_name):
        db.execute(text(f'SET search_path TO "{schema_name}", public'))
    else:
        if schema_name:
            logger.warning("Ignoring invalid schema name %r; using public", schema_name)
        db.execute(text("SET search_path TO public"))


@contextmanager
def tenant_scope(db: Session, company) -> Iterator[Session]:
    """Temporarily run an existing session inside ``company``'s schema, then reset.

    Used by cross-tenant code (platform-admin analytics, cron jobs) to visit each
    client's domain tables on one session without spinning up new sessions.
    """
    set_search_path(db, schema_name_for(company))
    try:
        yield db
    finally:
        set_search_path(db, None)


# ── request → schema resolution (lenient, best-effort) ────────────────────────


def _token_from_request(request) -> str | None:
    auth = request.headers.get("authorization") if request is not None else None
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(ACCESS_COOKIE) if request is not None else None


def schema_from_token(token: str | None) -> str | None:
    """Pull the ``schema`` claim out of an access token. Best-effort: any decode
    failure (missing/expired/garbled) returns None and the caller falls back to
    ``public`` — real auth validation/401 happens later in get_current_user."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except Exception:
        return None
    if payload.get("type") != "access":
        return None
    return payload.get("schema")


def apply_request_schema(db: Session, request) -> None:
    """Set the session's search_path from the request's access token (if any)."""
    set_search_path(db, schema_from_token(_token_from_request(request)))


# ── provisioning ──────────────────────────────────────────────────────────────

# System reference catalogs seeded into every NEW client schema (mirrors seed.py).
# Rows are company_id=NULL — i.e. that client's copy of the shared catalog, which
# the allow_shared logic in services/base.py treats as system rows.
_SYSTEM_VARIETIES = [
    ("Rc222", "NSIC Rc222", "inbred", 66.0),
    ("Rc216", "NSIC Rc216", "inbred", 65.0),
    ("Rc218", "NSIC Rc218", "inbred", 65.0),
    ("Rc298", "NSIC Rc298", "inbred", 66.0),
    ("PSB14", "PSB Rc14", "inbred", 64.0),
    ("SINAG", "Sinag (Hybrid)", "hybrid", 68.0),
    ("MESTIZO", "Mestizo (Hybrid)", "hybrid", 68.0),
    ("LOCAL", "Local Variety", "local", 62.0),
]
_SYSTEM_GRADES = [
    ("A", "Grade A", 0.0, 14.0),
    ("B", "Grade B", 14.1, 18.0),
    ("C", "Grade C", 18.1, 22.0),
    ("NFA1", "NFA Grade 1", 0.0, 14.0),
    ("NFA2", "NFA Grade 2", 14.1, 18.0),
]


def seed_reference_rows(db: Session) -> None:
    """Seed system rice varieties + quality grades into the CURRENT schema.

    Caller must have already pointed ``db`` at the target client schema. Idempotent
    (skips rows that already exist). Flush only — caller owns the transaction.
    """
    from ..models.reference import QualityGrade, RiceVariety

    for code, name, cat, rec in _SYSTEM_VARIETIES:
        exists = db.query(RiceVariety).filter_by(code=code, company_id=None).first()
        if not exists:
            db.add(RiceVariety(code=code, name=name, category=cat, typical_recovery_pct=rec))
    for code, name, mn, mx in _SYSTEM_GRADES:
        exists = db.query(QualityGrade).filter_by(code=code, company_id=None).first()
        if not exists:
            db.add(QualityGrade(code=code, name=name, min_moisture_pct=mn, max_moisture_pct=mx))
    db.flush()


def provision_tenant(company, *, db: Session | None = None) -> str:
    """Create a client's schema, build its domain tables, and seed reference rows.

    Idempotent: ``CREATE SCHEMA IF NOT EXISTS`` + ``create_all`` (checkfirst) +
    skip-existing seeds, so it's safe to re-run.

    Pass ``db`` to run inside an existing transaction (e.g. signup), in which case
    the caller commits. With no ``db`` it opens, commits, and closes its own
    session (used by scripts / platform-admin provisioning).
    """
    schema = schema_name_for(company)
    if not valid_schema_name(schema):
        raise ValueError(f"Refusing to provision unsafe schema name {schema!r}")

    own = db is None
    session = db or SessionLocal()
    try:
        # 1. Create the schema. Must be visible to the connection that create_all
        #    runs on, so flush/commit the DDL first.
        session.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        session.flush()

        # 2. Build the per-client domain tables inside it. With search_path set to
        #    the new schema, create_all targets it; cross-schema FKs (-> public.
        #    companies / branches / users) resolve via the public fallback.
        set_search_path(session, schema)
        Base.metadata.create_all(bind=session.connection(), tables=tenant_tables())

        # 3. Seed that client's system reference catalog.
        seed_reference_rows(session)

        if own:
            session.commit()
        # Reset so a caller-supplied session isn't left scoped to this schema.
        set_search_path(session, None)
        logger.info("Provisioned tenant schema %s for company %s", schema, company.id)
        return schema
    except Exception:
        if own:
            session.rollback()
        raise
    finally:
        if own:
            session.close()


# ── future hook: per-client physical database ────────────────────────────────

_tenant_engines: dict[str, Engine] = {}


def engine_for(company) -> Engine:
    """The engine a client's data lives on.

    Dormant by default: returns the shared ``engine`` unless the company has a
    ``db_url`` set (its own physical database). Per-URL engines are cached so a
    relocated client gets one pool, not one per request.
    """
    url = getattr(company, "db_url", None)
    if not url:
        return engine
    eng = _tenant_engines.get(url)
    if eng is None:
        eng = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=10)
        _tenant_engines[url] = eng
    return eng


def iter_tenant_sessions() -> Iterator[tuple]:
    """Yield ``(company, session)`` for every active client, scoped to its schema.

    For cross-tenant batch work (cron, reporting) that needs an isolated session
    per client. Each session is closed after the caller resumes the generator.
    """
    from ..models.company import Company

    catalog = SessionLocal()
    try:
        companies = catalog.query(Company).all()
    finally:
        catalog.close()

    for company in companies:
        session = SessionLocal()
        try:
            set_search_path(session, schema_name_for(company))
            yield company, session
        finally:
            session.close()
