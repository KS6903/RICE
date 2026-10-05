"""Print what each automation would send for a tenant right now, sending nothing.

For checking recipes against real data, and for tuning the AI recipes' prompts
against what the model actually writes. Runs every recipe as a test run, so
no remembered state changes and nobody is notified. AI recipes call DeepSeek
(a few cents each) only with --ai.

Usage, from backend/:
    python scripts/preview_automations.py mill1
    python scripts/preview_automations.py mill1 --ai --language taglish
    python scripts/preview_automations.py mill1 --only ai_leakage_watch,low_stock --ai
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.automations import ai  # noqa: E402
from app.automations.base import RecipeContext, RecipeProblem  # noqa: E402
from app.automations.engine import parse_params  # noqa: E402
from app.automations.recipes import RECIPES  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.tenancy import set_search_path  # noqa: E402
from app.core.timezones import tenant_zone  # noqa: E402
from app.models.automation import AutomationRule  # noqa: E402
from app.models.user import User  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("username")
    parser.add_argument("--ai", action="store_true", help="include the AI recipes (calls DeepSeek)")
    parser.add_argument("--only", default="", help="comma-separated recipe codes")
    parser.add_argument("--language", default="en", choices=tuple(ai.LANGUAGES))
    args = parser.parse_args()
    only = {c.strip() for c in args.only.split(",") if c.strip()}

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == args.username).first()
        if user is None or user.company is None:
            sys.exit(f"no such user: {args.username}")
        company = user.company
        set_search_path(db, company.schema_name)
        ctx = RecipeContext(
            db=db,
            company=company,
            now=datetime.now(timezone.utc),
            zone=tenant_zone(company.timezone),
            test=True,
            language=args.language,
        )
        for code, recipe in RECIPES.items():
            if (only and code not in only) or (recipe.uses_ai and not args.ai):
                continue
            rule = db.query(AutomationRule).filter(AutomationRule.recipe == code).first()
            params = parse_params(recipe, rule.params if rule else None)
            started = time.monotonic()
            try:
                notices = recipe.build(ctx, params)
            except RecipeProblem as exc:
                print(f"\n=== {code}: can't run as set up: {exc}")
                continue
            took = time.monotonic() - started
            print(f"\n=== {code} ({len(notices)} notice(s), {took:.1f}s)")
            if recipe.uses_ai:
                for sentence in ai.last_dropped:
                    print(f"[figure check dropped: {sentence}]")
            for n in notices:
                print(f"--- {n.title}")
                print(n.body)
                for a in n.attachments:
                    print(f"[attached {a.filename}, {len(a.content)} bytes]")
            db.rollback()  # a test run writes nothing, but be sure
    finally:
        db.close()


if __name__ == "__main__":
    main()
