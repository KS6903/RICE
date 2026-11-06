"""How far each page of the app has been released, and BossAdmin's per-mill
switches: BossAdmin's directory of pages (api/admin.py, /admin/pages).

Every push to main reaches every mill's servers at once, so a new page is held
back here instead: it starts at the stage the code gives it in ``CODE_STAGES``
(a new page goes in at ``bossadmin``), and BossAdmin moves it on, one stage at
a time or straight to everyone:

    bossadmin   only BossAdmin, through "View as" in any mill
    enterprise  Enterprise mills (and BossAdmin)
    pro         Pro and Enterprise
    basic       Basic, Pro and Enterprise
    everyone    every mill, Free included

On top of the stage, BossAdmin can turn a page on for one mill early (a tester)
or off for one mill whatever the stage (companies.page_overrides).

A page a mill can't have is closed for everyone in it: the server refuses it
(require_section_access) and /me tells the app, which hides it. It sits on top
of the plan's features and the role matrix, never instead of them. Settings
and the dashboard are always there: they hold the account itself.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Mapping

from .access_policy import ALL_SECTIONS

STAGES: tuple[str, ...] = ("bossadmin", "enterprise", "pro", "basic", "everyone")
# The plan codes each stage reaches, beyond BossAdmin.
_REACHES: dict[str, frozenset[str]] = {
    "bossadmin": frozenset(),
    "enterprise": frozenset({"enterprise"}),
    "pro": frozenset({"pro", "enterprise"}),
    "basic": frozenset({"basic", "pro", "enterprise"}),
}
ALWAYS_ON: frozenset[str] = frozenset({"settings", "dashboard"})
CONTROLLED: tuple[str, ...] = tuple(s for s in ALL_SECTIONS if s not in ALWAYS_ON)
OVERRIDES = ("on", "off")

# Where a page starts before BossAdmin has moved it. A page not named here is
# out to everyone. A NEW page goes in here at "bossadmin".
CODE_STAGES: dict[str, str] = {}

# The stages BossAdmin has set, read from page_releases. Every API process keeps
# its own copy for a short while, so a change reaches all of them within it.
_TTL_SECONDS = 20.0
_lock = threading.Lock()
_cached: tuple[float, dict[str, str]] | None = None


def _stored_stages(db) -> dict[str, str]:
    global _cached
    now = time.monotonic()
    with _lock:
        if _cached is not None and now - _cached[0] < _TTL_SECONDS:
            return _cached[1]
    from ..models.platform import PageRelease

    rows = {r.section: r.stage for r in db.query(PageRelease).all() if r.stage in STAGES}
    with _lock:
        _cached = (now, rows)
    return rows


def forget_cached() -> None:
    """Drop this process's copy (after BossAdmin changes a stage)."""
    global _cached
    with _lock:
        _cached = None


def stages(db) -> dict[str, str]:
    """Every controlled page's stage now."""
    stored = _stored_stages(db)
    return {s: stored.get(s) or CODE_STAGES.get(s, "everyone") for s in CONTROLLED}


def clean_overrides(stored: Any) -> dict[str, str]:
    if not isinstance(stored, Mapping):
        return {}
    return {s: v for s, v in stored.items() if s in CONTROLLED and v in OVERRIDES}


def reaches(stage: str, plan_code: str | None) -> bool:
    if stage == "everyone":
        return True
    return (plan_code or "free") in _REACHES.get(stage, frozenset())


def closed_pages(db, company: Any, plan_code: Callable[[], str | None], *, bossadmin: bool) -> set[str]:
    """The pages this mill doesn't get. ``bossadmin`` is a "View as" visit:
    it sees what is held back too, but not what the mill has turned off. The
    plan is only looked up when some page is held back."""
    overrides = clean_overrides(getattr(company, "page_overrides", None))
    held = {s: st for s, st in stages(db).items() if st != "everyone"}
    if not held and not overrides:
        return set()
    code = plan_code() if held and not bossadmin else None
    closed: set[str] = set()
    for section in CONTROLLED:
        override = overrides.get(section)
        if override == "off":
            closed.add(section)
        elif override == "on" or bossadmin or section not in held:
            continue
        elif not reaches(held[section], code):
            closed.add(section)
    return closed


def plan_code_for(db, company_id) -> str | None:
    """The plan the mill is on now: Free once a paid plan has run out."""
    from ..models.subscription import Subscription
    from ..services.subscription import ACTIVE_STATUSES, effective_status

    sub = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    if not sub or not sub.plan or effective_status(sub) not in ACTIVE_STATUSES:
        return "free"
    return sub.plan.code


def apply(access: dict[str, str], closed: set[str]) -> dict[str, str]:
    return {s: ("none" if s in closed else lvl) for s, lvl in access.items()}
