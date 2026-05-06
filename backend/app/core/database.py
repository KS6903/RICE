from sqlalchemy import create_engine, URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from urllib.parse import urlparse
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
