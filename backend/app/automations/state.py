"""Report a condition once when it starts, and again only after it clears.

Low stock, old rice, an overloaded zone: these stay true for days. A recipe
that checks them every morning passes the keys that are true today; only the
keys that weren't true last time come back, to be reported. Keys no longer
true are forgotten, so the next time they come true they're reported again.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..models.automation import AutomationState
from .base import RecipeContext


def newly_true(ctx: RecipeContext, recipe: str, keys: Iterable[str]) -> set[str]:
    """The keys in ``keys`` that weren't true on the last run, remembering
    ``keys`` for next time. Doesn't commit: the engine commits with the
    notices, so a failed run forgets nothing. A test run changes nothing and
    returns every key."""
    current = set(keys)
    if ctx.test:
        return current
    rows = ctx.db.query(AutomationState).filter(AutomationState.recipe == recipe).all()
    before = {row.key for row in rows}
    for row in rows:
        if row.key not in current:
            ctx.db.delete(row)
    for key in current - before:
        ctx.db.add(AutomationState(company_id=ctx.company.id, recipe=recipe, key=key, since=ctx.now))
    return current - before
