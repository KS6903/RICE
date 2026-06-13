from sqlalchemy import create_engine, URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from urllib.parse import urlparse
from fastapi import Request
from .config import settings


def _build_engine_url() -> str | URL:
    raw = settings.DATABASE_URL
    # Parse out components to handle db names with spaces
    parsed = urlparse(raw)
    dbname = parsed.path.lstrip("/")  # may contain spaces
    if " " in dbname:
        return URL.create(
            drivername="postgresql+psycopg",
            username=parsed.username,
            password=parsed.password,
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=dbname,
        )
    return raw.replace("postgresql://", "postgresql+psycopg://")


engine = create_engine(
    _build_engine_url(),
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db(request: Request = None):
    """Per-request session, scoped to the caller's client schema.

    The client is resolved from the access token's ``schema`` claim and applied
    via ``SET search_path`` before the session is handed out. Unauthenticated
    routes (login/signup/refresh, health) carry no token, so the session stays on
    ``public`` only — where identity + the control plane live — which is exactly
    what auth/get_current_user need before any client is known.

    ``request`` is injected by FastAPI; it's optional so the dependency can also
    be called/overridden without one (tests, ad-hoc use).
    """
    # Imported lazily to avoid a circular import (tenancy imports this module).
    # resolve_request_session picks the engine (shared, or the client's own
    # database when promoted via Company.db_url) and sets search_path from the
    # access token, then returns a ready session.
    from .tenancy import resolve_request_session

    db = resolve_request_session(request)
    try:
        yield db
    finally:
        db.close()
