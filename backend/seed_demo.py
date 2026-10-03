"""Demo data for the test tenants, in one command.

The test cohort (CLAUDE.md): Tier 1 is mill1-mill3, who get new features
first; Tier 2 is mill4-mill8. mill1 is the only Enterprise tenant, so the
Enterprise automations demo seeds there and nowhere else.

The parts, in the order they run. Each one marks what it creates and skips a
tenant it has already seeded, so running this twice changes nothing:
  base         suppliers, customers, employees, equipment, palay purchases,
               milling, fleet and dispatch, warehouse pallets (seed_demo_full.py)
  inventory    palay, milled rice and by-product stock (seed_demo_inventory.py)
  sales        this year's sales and expenses, a different profile per mill
               (seed_demo_sales.py)
  automations  sixty days of activity for the Enterprise recipes, mill1 only
               (seed_demo_automations.py; --reset replaces it)

Usage, from backend/, after `alembic upgrade head` and `migrate_all_tenants.py`:
    python seed_demo.py                       # Tier 1: mill1-mill3 (the default)
    python seed_demo.py --all                 # mill1-mill8
    python seed_demo.py mill4 mill5           # these tenants
    python seed_demo.py --only sales,base     # just these parts
    python seed_demo.py --reset               # replace the automations demo

It writes demo data, so it runs against a database on this machine only, unless
--allow-remote says otherwise.
"""

from __future__ import annotations

import argparse
import re
from collections.abc import Callable

from sqlalchemy.engine import make_url

TIER_1 = [f"mill{i}" for i in range(1, 4)]
EVERYONE = [f"mill{i}" for i in range(1, 9)]
# The one Enterprise test tenant (CLAUDE.md).
ENTERPRISE = {"mill1"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _base(username: str, reset: bool) -> str:
    import seed_demo_full

    return seed_demo_full.seed_company(username)


def _inventory(username: str, reset: bool) -> str:
    import seed_demo_inventory

    return _with_session(lambda db: seed_demo_inventory.seed(db, username))


def _sales(username: str, reset: bool) -> str:
    import seed_demo_sales

    # The mill's number keeps its order numbers stable, whoever else is seeded.
    match = re.fullmatch(r"mill(\d+)", username)
    number = int(match.group(1)) if match else 99
    return _with_session(lambda db: seed_demo_sales.seed_tenant(db, username, number))


def _automations(username: str, reset: bool) -> str:
    if username not in ENTERPRISE:
        return f"{username}: Enterprise demo, mill1 only — skipped"
    import seed_demo_automations

    return _with_session(lambda db: seed_demo_automations.seed(db, username, reset=reset))


PARTS: dict[str, Callable[[str, bool], str]] = {
    "base": _base,
    "inventory": _inventory,
    "sales": _sales,
    "automations": _automations,
}


def _with_session(work: Callable) -> str:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        return work(db)
    finally:
        db.close()


def database_host() -> str:
    from app.core.config import settings

    return make_url(settings.DATABASE_URL).host or "localhost"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("tenants", nargs="*", help="usernames (default: Tier 1, mill1-mill3)")
    parser.add_argument("--all", action="store_true", help="mill1-mill8")
    parser.add_argument("--tier1", action="store_true", help="mill1-mill3 (the default)")
    parser.add_argument("--only", default="", help=f"comma-separated parts: {', '.join(PARTS)}")
    parser.add_argument("--reset", action="store_true", help="replace the automations demo")
    parser.add_argument("--allow-remote", action="store_true", help="seed a database on another machine")
    args = parser.parse_args(argv)

    if args.tenants and (args.all or args.tier1):
        parser.error("name tenants, or pass --all/--tier1, not both")
    tenants = args.tenants or (EVERYONE if args.all else TIER_1)
    parts = [p.strip() for p in args.only.split(",") if p.strip()] or list(PARTS)
    unknown = [p for p in parts if p not in PARTS]
    if unknown:
        parser.error(f"unknown part(s): {', '.join(unknown)}; choose from {', '.join(PARTS)}")

    host = database_host()
    if host not in LOCAL_HOSTS and not args.allow_remote:
        parser.error(f"refusing: the database is on {host}, not this machine (pass --allow-remote if you mean it)")

    for part in PARTS:  # always in dependency order, whatever order --only gave
        if part not in parts:
            continue
        print(f"== {part}", flush=True)
        for username in tenants:
            print(f"  {PARTS[part](username, args.reset)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
