"""Restore drill: can production's data come back, whole, into an empty database?

1. Opens a repeatable-read transaction on the source and exports its snapshot.
   Every table in ``public`` and the tenant schemas is counted inside that
   snapshot, and ``pg_dump --snapshot`` dumps that same snapshot, so the counts
   describe exactly what the dump holds, however busy the source is.
2. Restores the dump into the target, a database this script drops and
   recreates (its name must contain "restore_drill").
3. Checks the restored copy: the same migration version as the source, every
   set-up tenant's schema with every table and column the code expects, and the
   same row count in every table.

Nothing is kept: the dump lives in a temporary directory removed at the end.
It holds every mill's data, so run this only where that data is allowed to be:
the database's own region, on infrastructure listed in the sub-processor
register (legal/subprocessors.md).

The source role needs read access to everything (PostgreSQL 14+:
``GRANT pg_read_all_data TO <role>``) and a direct connection: a transaction-mode
pooler can't hold the exported snapshot.

Usage, from backend/, with BACKUP_SOURCE_DATABASE_URL and
RESTORE_DRILL_TARGET_URL (e.g. postgresql://u:p@localhost/restore_drill) set:
    python scripts/restore_drill.py [--pg-bin /usr/lib/postgresql/17/bin]

Exit status 0 when the restore matches; 1 when anything differs or fails.
With GITHUB_STEP_SUMMARY set, a report is appended to it.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlparse, urlunparse

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Our schemas only: public (the control plane) and one per tenant.
SCHEMAS_SQL = "SELECT nspname FROM pg_namespace WHERE nspname = 'public' OR nspname LIKE 'client\\_%' ORDER BY 1"
TABLES_SQL = (
    "SELECT table_schema, table_name FROM information_schema.tables "
    "WHERE table_type = 'BASE TABLE' AND (table_schema = 'public' OR table_schema LIKE 'client\\_%') "
    "ORDER BY 1, 2"
)


@dataclass
class Report:
    problems: list[str] = field(default_factory=list)
    facts: list[tuple[str, str]] = field(default_factory=list)

    def fact(self, name: str, value: object) -> None:
        self.facts.append((name, str(value)))
        print(f"  {name}: {value}", flush=True)

    def problem(self, text: str) -> None:
        self.problems.append(text)
        print(f"  PROBLEM: {text}", flush=True)


def _plain(url: str) -> str:
    """A libpq URL: no SQLAlchemy +driver, and a percent-encoded database name
    and query (libpq rejects the spaces SQLAlchemy lets through)."""
    parsed = urlparse(url)
    path = quote(unquote(parsed.path))
    query = urlencode(parse_qsl(parsed.query, keep_blank_values=True), quote_via=quote)
    return urlunparse(parsed._replace(scheme="postgresql", path=path, query=query))


def _libpq(url: str) -> tuple[str, dict[str, str]]:
    """The URL for a client tool's command line, and its environment.

    The password goes in the environment: on the command line, any process
    listing would show it.
    """
    parsed = urlparse(url)
    env = dict(os.environ)
    if parsed.password is not None:
        env["PGPASSWORD"] = unquote(parsed.password)
        host = parsed.hostname or ""
        netloc = f"{parsed.username}@{host}" + (f":{parsed.port}" if parsed.port else "")
        parsed = parsed._replace(netloc=netloc)
    return urlunparse(parsed), env


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _tool(pg_bin: str | None, name: str) -> str:
    found = shutil.which(name, path=pg_bin) if pg_bin else shutil.which(name)
    if not found:
        raise SystemExit(f"{name} not found; pass --pg-bin with the PostgreSQL client directory")
    return found


def _one(conn, sql: str) -> Any:
    """The single value a query returns."""
    row = conn.execute(sql).fetchone()
    if row is None:
        raise RuntimeError(f"no row from: {sql}")
    return row[0]


def _counts(conn) -> dict[tuple[str, str], int]:
    tables = conn.execute(TABLES_SQL).fetchall()
    return {
        (schema, table): _one(conn, f"SELECT count(*) FROM {_quote(schema)}.{_quote(table)}")
        for schema, table in tables
    }


def _alembic_version(conn) -> tuple[str, ...]:
    exists = _one(conn, "SELECT to_regclass('public.alembic_version')")
    if not exists:
        return ()
    return tuple(sorted(r[0] for r in conn.execute("SELECT version_num FROM public.alembic_version")))


def _v(version: tuple[str, ...]) -> str:
    return ", ".join(version) or "none"


def _recreate(target: str) -> None:
    import psycopg

    parsed = urlparse(target)
    name = unquote(parsed.path.lstrip("/"))
    admin = urlunparse(parsed._replace(path="/postgres"))
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {_quote(name)} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {_quote(name)}")
    # The dump creates public itself (it names it with --schema), so the new
    # database's own would clash.
    with psycopg.connect(target, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public")


def _dump(source: str, pg_bin: str | None, workdir: Path, report: Report):
    """Count every table inside an exported snapshot and dump that snapshot."""
    import psycopg

    dump = workdir / "drill.dump"
    conn = psycopg.connect(source)
    try:
        conn.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        snapshot = _one(conn, "SELECT pg_export_snapshot()")
        server = _one(conn, "SHOW server_version")
        schemas = [r[0] for r in conn.execute(SCHEMAS_SQL)]
        version = _alembic_version(conn)
        tenants = conn.execute(
            "SELECT schema_name FROM public.companies WHERE provisioned_at IS NOT NULL ORDER BY 1"
        ).fetchall()
        counts = _counts(conn)
        report.fact("source PostgreSQL", server)
        report.fact("source migration version", _v(version))
        report.fact("tenant schemas", len([s for s in schemas if s != "public"]))
        report.fact("tables counted", len(counts))
        report.fact("rows counted", f"{sum(counts.values()):,}")

        started = time.monotonic()
        url, env = _libpq(source)
        args = [_tool(pg_bin, "pg_dump"), "--format=custom", f"--snapshot={snapshot}", f"--file={dump}"]
        args += [f"--schema={s}" for s in schemas]
        result = subprocess.run([*args, f"--dbname={url}"], env=env)
        if result.returncode != 0:
            raise SystemExit("pg_dump failed")
        report.fact("dump", f"{dump.stat().st_size / 1_048_576:.1f} MiB in {time.monotonic() - started:.0f}s")
    finally:
        conn.close()  # ends the transaction, and with it the snapshot
    return dump, counts, version, [t[0] for t in tenants]


def _restore(dump: Path, target: str, pg_bin: str | None, report: Report) -> None:
    """Restore everything that will restore, and report each thing that won't.

    Not --exit-on-error: a row that breaks a constraint (say, a subscription
    whose company was deleted with triggers off) stops only that constraint,
    and the drill should list every such problem, then still compare the data.
    """
    started = time.monotonic()
    # No owners or grants: the drill database has none of production's roles.
    url, env = _libpq(target)
    args = [_tool(pg_bin, "pg_restore"), "--no-owner", "--no-privileges"]
    result = subprocess.run([*args, f"--dbname={url}", str(dump)], env=env, capture_output=True, text=True)
    errors: list[str] = []
    for line in result.stderr.splitlines():
        if line.startswith("pg_restore: error:"):
            errors.append(line.removeprefix("pg_restore: error: ").strip())
        elif line.startswith("DETAIL:") and errors:
            errors[-1] += " " + line.strip()
    for error in errors:
        report.problem(error)
    if result.returncode != 0 and not errors:
        print(result.stderr, file=sys.stderr)
        report.problem(f"pg_restore exited {result.returncode}")
    report.fact("restore", f"{time.monotonic() - started:.0f}s")


def _check(target: str, counts, version, tenants, report: Report) -> None:
    import psycopg

    from app.core.health import code_heads
    from app.core.tenancy import tenant_tables

    with psycopg.connect(target) as conn:
        restored_version = _alembic_version(conn)
        if restored_version != version:
            report.problem(f"migration version {_v(restored_version)} after restore, {_v(version)} before")

        heads = code_heads()
        if version == heads:
            expected = {t.name: {c.name for c in t.columns} for t in tenant_tables()}
            for schema in tenants:
                rows = conn.execute(
                    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = %s",
                    (schema,),
                ).fetchall()
                have: dict[str, set[str]] = {}
                for table, column in rows:
                    have.setdefault(table, set()).add(column)
                for table, columns in expected.items():
                    if table not in have:
                        report.problem(f"{schema}.{table} is missing")
                    elif missing := columns - have[table]:
                        report.problem(f"{schema}.{table} lacks {', '.join(sorted(missing))}")
            report.fact("tenant structure", f"{len(tenants)} schemas checked against the code")
        else:
            report.fact("tenant structure", f"not checked: the source is at {_v(version)}, this code at {_v(heads)}")

        restored = _counts(conn)
        for key in sorted(counts.keys() | restored.keys()):
            before, after = counts.get(key), restored.get(key)
            if before != after:
                report.problem(f"{key[0]}.{key[1]}: {before} rows before, {after} after")
        report.fact("rows restored", f"{sum(restored.values()):,}")


def _summary(report: Report, elapsed: float) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    verdict = "passed" if not report.problems else f"FAILED ({len(report.problems)} problems)"
    lines = [f"## Restore drill {verdict}", "", "| | |", "|---|---|"]
    lines += [f"| {name} | {value} |" for name, value in report.facts]
    lines.append(f"| total | {elapsed:.0f}s |")
    if report.problems:
        lines += ["", "### Problems", ""] + [f"- {p}" for p in report.problems[:50]]
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    # URLs come from the environment by default: on the command line, any
    # process listing would show their passwords.
    parser.add_argument(
        "--source",
        default=os.environ.get("BACKUP_SOURCE_DATABASE_URL"),
        help="the database to back up, as a read-only role (default: $BACKUP_SOURCE_DATABASE_URL)",
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("RESTORE_DRILL_TARGET_URL"),
        help="a scratch database, dropped and recreated (default: $RESTORE_DRILL_TARGET_URL)",
    )
    parser.add_argument("--pg-bin", default=os.environ.get("PG_BIN"), help="PostgreSQL client tools directory")
    args = parser.parse_args()
    if not args.source or not args.target:
        parser.error("set the source and target (the environment variables, or --source and --target)")

    source, target = _plain(args.source), _plain(args.target)
    s, t = urlparse(source), urlparse(target)
    if "restore_drill" not in t.path:
        parser.error("refusing: the target database's name must contain 'restore_drill' (it is dropped)")
    if (s.hostname, s.port, s.path) == (t.hostname, t.port, t.path):
        parser.error("refusing: the target is the source")

    report = Report()
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="restore-drill-") as tmp:
        print("== dump the source, inside one snapshot", flush=True)
        dump, counts, version, tenants = _dump(source, args.pg_bin, Path(tmp), report)
        print("== restore into an empty database", flush=True)
        _recreate(target)
        _restore(dump, target, args.pg_bin, report)
    print("== compare", flush=True)
    _check(target, counts, version, tenants, report)
    elapsed = time.monotonic() - started
    _summary(report, elapsed)
    if report.problems:
        print(f"Restore drill FAILED: {len(report.problems)} problem{'s' if len(report.problems) != 1 else ''}.")
        return 1
    print(f"Restore drill passed in {elapsed:.0f}s.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
