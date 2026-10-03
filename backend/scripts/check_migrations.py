"""Do the migrations produce exactly the schema the models describe?

Two paths, both checked with ``alembic check`` (autogenerate finds nothing to
do), on a disposable database:

1. Upgrade: the schema as ``--base-ref`` (main) migrates it, then this
   branch's new migrations on top. This is what production goes through.
2. Fresh: every migration from an empty database. This is what a new
   environment goes through, and where "001 already built it from the
   models" surprises live.

Only public tables are compared (migrations/env.py); tenant schemas are built
from the models directly by the provisioner.

Usage, from backend/:
    python scripts/check_migrations.py --database-url postgresql://u:p@host/rice_drift [--base-ref origin/main]

The database is dropped and recreated, so its name must contain "drift".
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse, urlunparse

BACKEND = Path(__file__).resolve().parents[1]


def _recreate(url: str) -> None:
    import psycopg

    parsed = urlparse(url)
    name = parsed.path.lstrip("/")
    admin = urlunparse(parsed._replace(path="/postgres", scheme="postgresql"))
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')


def _alembic(args: list[str], *, cwd: Path, url: str) -> None:
    # The base checkout has no .env of its own: pass this one's settings along
    # (anything already in the environment, as in CI, wins).
    from dotenv import dotenv_values

    local = {k: v for k, v in dotenv_values(BACKEND / ".env").items() if v is not None}
    env = {
        **local,
        **os.environ,
        "DATABASE_URL": url,
        "PROVISIONER_DATABASE_URL": url,
        "PYTHONIOENCODING": "utf-8",
    }
    print(f"$ alembic {' '.join(args)}  ({cwd.name if cwd != BACKEND else 'this branch'})", flush=True)
    result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=cwd, env=env)
    if result.returncode != 0:
        raise SystemExit(f"alembic {' '.join(args)} failed")


def _upgrade_from(ref: str, url: str) -> None:
    """Migrate to the schema ``ref`` would leave, from its own checkout."""
    workdir = Path(tempfile.mkdtemp(prefix="migrations-base-"))
    try:
        subprocess.run(["git", "worktree", "add", "--detach", str(workdir), ref], check=True, cwd=BACKEND)
        _alembic(["upgrade", "head"], cwd=workdir / "backend", url=url)
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(workdir)], cwd=BACKEND)
        shutil.rmtree(workdir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--base-ref", default="", help="git ref whose schema to upgrade from (e.g. origin/main)")
    args = parser.parse_args()
    if "drift" not in urlparse(args.database_url).path:
        parser.error("refusing: the database name must contain 'drift' (it is dropped and recreated)")

    if args.base_ref:
        print(f"== upgrade path: {args.base_ref}'s schema, then this branch's migrations", flush=True)
        _recreate(args.database_url)
        _upgrade_from(args.base_ref, args.database_url)
        _alembic(["upgrade", "head"], cwd=BACKEND, url=args.database_url)
        _alembic(["check"], cwd=BACKEND, url=args.database_url)

    print("== fresh path: every migration from an empty database", flush=True)
    _recreate(args.database_url)
    _alembic(["upgrade", "head"], cwd=BACKEND, url=args.database_url)
    _alembic(["check"], cwd=BACKEND, url=args.database_url)
    print("Migrations match the models.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
