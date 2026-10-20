"""Schema-per-client multi-tenancy plumbing.

RICE runs every client (company) in its own PostgreSQL **schema** inside one shared
database. The shared ``public`` schema holds identity + the control plane
(companies, users, roles, subscriptions, …); each client gets a ``client_<hex>``
schema holding all of its domain data (paddy, milling, sales, warehouse, …).

A request resolves its client from the JWT (the ``schema`` claim) and runs against
that client's schema via ``SET search_path TO "<schema>", public`` — so unqualified
domain tables resolve to the client schema while shared identity/control-plane
tables fall back to ``public``.

Every client lives in the **one shared database**, isolated by its own schema —
there is no per-client physical database. The schema (in ``search_path``) is the
hard isolation boundary: an unqualified query can only ever resolve to the client
schema currently on the path, so cross-client reads are impossible by construction.

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
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from ..models.base import now_utc
from .config import settings
from .cookies import ACCESS_COOKIE
from .database import Base, ProvisionerSessionLocal, SessionLocal

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
        "user_locations",  # per-user UI state (FK -> users only)
        "legal_acceptances",  # consent evidence: must outlive a tenant schema
        "job_runs",  # scheduled-job claims; spans tenants
    }
)

# Postgres identifier rules we enforce before ever interpolating a schema name
# into DDL/SET (schema names can't be bound parameters). Server-generated names
# always match; this guards against anything unexpected reaching SQL.
_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def valid_schema_name(name: str | None) -> bool:
    if not name:
        return False
    return len(name) <= 63 and _SCHEMA_RE.fullmatch(name) is not None


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


# Where a session keeps the schema set_search_path chose for it.
_SEARCH_PATH_KEY = "oraiza.search_path"


def _search_path_sql(schema_name: str | None) -> str:
    """SET LOCAL for a validated schema; identifiers can't be bound parameters."""
    if schema_name is not None and valid_schema_name(schema_name):
        return f'SET LOCAL search_path TO "{schema_name}", public'
    return "SET LOCAL search_path TO public"


def set_search_path(db: Session, schema_name: str | None) -> None:
    """Point a session at a client schema (or back to ``public`` only) for the
    rest of its life.

    The choice is kept on the session and applied with SET LOCAL, which lasts
    only for the current transaction; _reapply_search_path applies it again at
    the start of every later one. A plain (session-level) SET is not enough:
    the session hands its pooled connection back at every commit and may borrow
    a different one next, a rollback undoes a SET made inside it, and a SET that
    did stick would follow the connection to its next borrower, which could be
    another tenant's request.
    """
    if schema_name and not valid_schema_name(schema_name):
        logger.warning("Ignoring invalid schema name %r; using public", schema_name)
        schema_name = None
    db.info[_SEARCH_PATH_KEY] = schema_name
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    db.execute(text(_search_path_sql(schema_name)))


@event.listens_for(Session, "after_begin")
def _reapply_search_path(session: Session, transaction, connection) -> None:
    """Give every transaction a session begins the schema the session was set to."""
    if _SEARCH_PATH_KEY in session.info:
        connection.exec_driver_sql(_search_path_sql(session.info[_SEARCH_PATH_KEY]))


# Cross-tenant code must visit each client by switching to its schema. Use
# tenant_session / iter_tenant_sessions below rather than ad-hoc search_path
# mutation, so the path is always restored afterwards.


# ── request → schema resolution (lenient, best-effort) ────────────────────────


def _token_from_request(request) -> str | None:
    auth = request.headers.get("authorization") if request is not None else None
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(ACCESS_COOKIE) if request is not None else None


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
        grade: QualityGrade | None = db.query(QualityGrade).filter_by(code=code, company_id=None).first()
        if not grade:
            db.add(QualityGrade(code=code, name=name, min_moisture_pct=mn, max_moisture_pct=mx))
    db.flush()


def grant_runtime_schema_access(session: Session, schema: str) -> None:
    """Grant the DML-only API role access to a provisioned tenant schema."""
    role = settings.RUNTIME_DATABASE_ROLE
    if not _SCHEMA_RE.fullmatch(role):
        raise ValueError("Unsafe runtime database role")
    # Callers pass company.schema_name straight through (migrate_all_tenants.py
    # does no check of its own), so validate here before it reaches SQL.
    if not valid_schema_name(schema):
        raise ValueError(f"Refusing to grant on unsafe schema name {schema!r}")
    # Identifiers can't be bound parameters; both were validated just above.
    statements = (
        f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"',
        f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "{schema}" TO "{role}"',
        f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "{schema}" TO "{role}"',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{role}"',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" GRANT USAGE, SELECT ON SEQUENCES TO "{role}"',
    )
    for statement in statements:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        session.execute(text(statement))


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
    session = db or ProvisionerSessionLocal()
    try:
        # 1. Create the schema. Must be visible to the connection that create_all
        #    runs on, so flush/commit the DDL first.
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        session.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        session.flush()

        # 2. Build the per-client domain tables inside it. With search_path set to
        #    the new schema, create_all targets it; cross-schema FKs (-> public.
        #    companies / branches / users) resolve via the public fallback.
        set_search_path(session, schema)
        Base.metadata.create_all(bind=session.connection(), tables=tenant_tables())

        # 3. Seed that client's system reference catalog.
        seed_reference_rows(session)

        # The DDL credential owns the schema; the API role receives only the
        # data privileges it needs. In dev/test the roles may be the same or the
        # dedicated role may not exist, so split-role grants are production-only.
        if settings.PROVISIONER_DATABASE_URL is not None:
            grant_runtime_schema_access(session, schema)

        if own:
            session.execute(
                text("UPDATE public.companies SET provisioned_at = now() WHERE id = :company_id"),
                {"company_id": company.id},
            )
        else:
            company.provisioned_at = now_utc()

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


# ── per-request session + cross-tenant helpers ───────────────────────────────
#
# Every client lives in the one shared database (one engine). A request runs
# against its client schema via search_path; cross-tenant code visits each client
# by switching search_path on a shared session.


def session_for_company(company) -> Session:
    """An open session scoped to a company's schema. Caller closes it."""
    s = SessionLocal()
    set_search_path(s, schema_name_for(company))
    return s


def resolve_request_session(request) -> Session:
    """Build the per-request session, scoped to the caller's client schema.

    Reads the access token's ``schema`` claim and applies it via search_path. No/
    expired token yields a session on ``public`` only — exactly what auth /
    get_current_user need before any client is known. A present-but-invalid schema
    falls back to ``public`` (and is rejected for domain access by
    get_current_user's fail-closed guard), so a request can never resolve to
    another client's schema.
    """
    schema = None
    token = _token_from_request(request) if request is not None else None
    if token:
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM],
                issuer=settings.JWT_ISSUER,
                audience=settings.JWT_AUDIENCE,
            )
            if payload.get("type") == "access":
                schema = payload.get("schema")
        except Exception:
            pass
    s = SessionLocal()
    set_search_path(s, schema)
    return s


@contextmanager
def tenant_session(db: Session, company) -> Iterator[Session]:
    """Yield ``db`` scoped to ``company`` for cross-tenant code (platform-admin
    analytics, etc.), then restore the search_path.

    All clients share one engine, so this just switches search_path on the
    caller's session — it stays in the same transaction the request is in.
    """
    set_search_path(db, schema_name_for(company))
    try:
        yield db
    finally:
        set_search_path(db, None)


def iter_tenant_sessions() -> Iterator[tuple]:
    """Yield ``(company, session)`` for every client, each scoped to its schema.
    For cross-tenant batch work (cron, reporting). Each session is closed after
    the caller resumes the generator."""
    from ..models.company import Company

    catalog = SessionLocal()
    try:
        companies = catalog.query(Company).all()
    finally:
        catalog.close()

    for company in companies:
        session = session_for_company(company)
        try:
            yield company, session
        finally:
            session.close()
