import os
import sys
from logging.config import fileConfig
from urllib.parse import urlparse

from alembic import context
from sqlalchemy import URL, create_engine, pool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["PROCESS_ROLE"] = "provisioner"

# Import every model so the full metadata is registered on Base.metadata.
import app.models  # noqa: E402,F401
from app.core.config import settings  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.core.tenancy import PUBLIC_TABLE_NAMES  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):
    """Alembic (autogenerate) manages only the shared ``public`` tables here.

    Per-client domain tables live in ``client_<hex>`` schemas, provisioned from the
    ORM via core.tenancy and synced by migrate_all_tenants.py — so we exclude them
    from autogenerate to keep the public migration chain clean.
    """
    if type_ == "table":
        return name in PUBLIC_TABLE_NAMES
    return True


def _build_url():
    # Production migrations are DDL and must use the short-lived provisioner
    # credential, never the long-running API's DML-only runtime credential.
    raw = (
        settings.PROVISIONER_DATABASE_URL.get_secret_value()
        if settings.PROVISIONER_DATABASE_URL is not None
        else settings.DATABASE_URL
    )
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
    context.configure(
        url=_build_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(_build_url(), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
