from logging.config import fileConfig
from sqlalchemy import create_engine, URL, pool
from alembic import context
from urllib.parse import urlparse
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.config import settings
from app.core.database import Base

# Import all models so Alembic can detect all tables
from app.models import company, user, reference, supplier_customer, paddy, milling, sales, costs, compliance, sync, employee, subscription, activity  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def _build_url():
    raw = settings.DATABASE_URL
    parsed = urlparse(raw)
    dbname = parsed.path.lstrip("/")
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


def run_migrations_offline() -> None:
    context.configure(url=_build_url(), target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(_build_url(), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
