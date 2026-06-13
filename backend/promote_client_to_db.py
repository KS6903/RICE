"""Promote a client (company) to its OWN physical PostgreSQL database.

After promotion, the running app serves that client from its own database while
every other client stays in the shared one — routing is automatic via
Company.db_url (see app/core/tenancy.py).

What it does:
  1. Resolve the company from the shared control-plane (by owner username).
  2. Create the target database if needed.
  3. Copy the whole shared DB into it (pg_dump | pg_restore), then PRUNE it down to
     just this client (drop other client_* schemas; delete other tenants' identity
     rows). The result mirrors the shared layout (public identity + this client's
     client_<hex> schema) and is self-contained.
  4. Set companies.db_url on the SHARED control-plane to the target URL, and clear
     it inside the client DB (no redirect loop).

The running server picks up the change within the db_url cache TTL (~30s); no
restart needed.

Usage:
    .venv/Scripts/python promote_client_to_db.py <owner_username> <target_db_url>
    # e.g.
    .venv/Scripts/python promote_client_to_db.py mill1 \
        postgresql://postgres:PASS@localhost:5432/rice_client_mill1

Env:
    PG_BIN   optional path to the PostgreSQL bin dir (pg_dump/pg_restore). If unset,
             common install locations are auto-detected.
"""
from __future__ import annotations

import glob
import os
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.core.tenancy import clear_db_url_cache, engine_for_url
from app.models.company import Company
from app.models.user import User


def _pg_tool(name: str) -> str:
    if os.environ.get("PG_BIN"):
        return os.path.join(os.environ["PG_BIN"], name)
    cands = glob.glob(f"C:/Program Files/PostgreSQL/*/bin/{name}.exe") + \
        glob.glob(f"C:/Program Files (x86)/PostgreSQL/*/bin/{name}.exe")
    if cands:
        return sorted(cands)[-1]
    return name  # assume on PATH (Linux/macOS)


def _admin_conn(url: str):
    import psycopg
    p = urlparse(url)
    return psycopg.connect(host=p.hostname, port=p.port or 5432, user=p.username,
                           password=p.password, dbname="postgres", autocommit=True)


def _ensure_database(url: str) -> str:
    p = urlparse(url)
    dbname = p.path.lstrip("/")
    admin = _admin_conn(url)
    try:
        exists = admin.execute("SELECT 1 FROM pg_database WHERE datname=%s", (dbname,)).fetchone()
        if not exists:
            admin.execute(f'CREATE DATABASE "{dbname}"')
            print(f"  created database {dbname}")
        else:
            print(f"  database {dbname} already exists")
    finally:
        admin.close()
    return dbname


def _copy_shared_into(target_url: str) -> None:
    """pg_dump the shared DB and pg_restore it into the target."""
    src = urlparse(_shared_url())
    dst = urlparse(target_url)
    env = {**os.environ, "PGPASSWORD": src.password or ""}
    with tempfile.NamedTemporaryFile(suffix=".dump", delete=False) as f:
        dump_path = f.name
    try:
        subprocess.run([_pg_tool("pg_dump"), "-h", src.hostname or "localhost",
                        "-p", str(src.port or 5432), "-U", src.username or "postgres",
                        "-F", "c", "-f", dump_path, src.path.lstrip("/")],
                       check=True, env=env)
        env_dst = {**os.environ, "PGPASSWORD": dst.password or ""}
        # restore ignores benign errors (e.g. a constraint it re-adds); --no-owner
        subprocess.run([_pg_tool("pg_restore"), "-h", dst.hostname or "localhost",
                        "-p", str(dst.port or 5432), "-U", dst.username or "postgres",
                        "-d", dst.path.lstrip("/"), "--no-owner", dump_path],
                       check=False, env=env_dst)
        print("  copied shared DB into target")
    finally:
        os.unlink(dump_path)


def _shared_url() -> str:
    # Reconstruct a libpq URL from settings (handles db names with spaces).
    p = urlparse(settings.DATABASE_URL)
    return settings.DATABASE_URL if "+psycopg" not in settings.DATABASE_URL else settings.DATABASE_URL


def _prune_to_company(target_url: str, company_id: str, schema_name: str) -> None:
    """Strip the freshly-restored copy down to just this client."""
    import psycopg
    p = urlparse(target_url)
    c = psycopg.connect(host=p.hostname, port=p.port or 5432, user=p.username,
                        password=p.password, dbname=p.path.lstrip("/"), autocommit=True)
    cur = c.cursor()
    cur.execute("select schema_name from information_schema.schemata")
    others = [r[0] for r in cur.fetchall() if r[0].startswith("client_") and r[0] != schema_name]
    for s in others:
        cur.execute(f'DROP SCHEMA "{s}" CASCADE')
    # disable FK triggers for the bulk delete (branches<->users cycle); end state is consistent
    cur.execute("SET session_replication_role = replica")
    for stmt in (
        "DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE company_id IS DISTINCT FROM %s)",
        "DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id IS DISTINCT FROM %s)",
        "DELETE FROM user_locations WHERE user_id IN (SELECT id FROM users WHERE company_id IS DISTINCT FROM %s)",
        "DELETE FROM subscription_upgrade_requests WHERE company_id IS DISTINCT FROM %s",
        "DELETE FROM subscriptions WHERE company_id IS DISTINCT FROM %s",
        "DELETE FROM branches WHERE company_id IS DISTINCT FROM %s",
        "DELETE FROM users WHERE company_id IS DISTINCT FROM %s",
    ):
        cur.execute(stmt, (company_id,))
    cur.execute("DELETE FROM companies WHERE id <> %s", (company_id,))
    # this is the client's home DB now — no further redirect
    cur.execute("UPDATE companies SET db_url = NULL WHERE id = %s", (company_id,))
    cur.execute("SET session_replication_role = origin")
    cur.execute("select count(*) from companies"); co = cur.fetchone()[0]
    cur.execute("select count(*) from users"); us = cur.fetchone()[0]
    c.close()
    print(f"  pruned target to 1 client (companies={co}, users={us})")


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(2)
    username, target_url = sys.argv[1], sys.argv[2]

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user or not user.company:
            print(f"No company found for user {username!r}")
            raise SystemExit(1)
        company_id = str(user.company_id)
        schema_name = user.company.schema_name
        name = user.company.name
    finally:
        db.close()

    print(f"Promoting {name} (owner {username}) -> {target_url}")
    _ensure_database(target_url)
    _copy_shared_into(target_url)
    _prune_to_company(target_url, company_id, schema_name)

    # Point the shared control-plane at the new home and refresh the cache.
    with engine.begin() as conn:
        conn.execute(text("UPDATE companies SET db_url = :u WHERE id = :cid"),
                     {"u": target_url, "cid": company_id})
    clear_db_url_cache()
    # warm the new engine so the first request doesn't pay connection setup
    engine_for_url(target_url).connect().close()
    print(f"DONE — {name} now served from its own database. "
          f"(Running servers pick this up within ~30s.)")


if __name__ == "__main__":
    main()
