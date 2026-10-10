"""How complete the figures are: desktop apps gone quiet, and work entered offline.

The desktop app keeps working without the internet and sends what was entered
when it reconnects (api/sync). What it sends is kept for the other desktop
apps; it isn't added to the web app's own records, so the web app's figures,
and every automation built on them, leave it out. Saying so is better than
summaries that look complete and aren't: this recipe tells the owner each
morning which desktop apps have gone quiet and how much was entered offline,
and the summaries add a line when offline work is missing from their period.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta

from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..jobs.schedule import daily
from ..models.sync import SyncConflict, SyncLog
from .base import Field, Notice, Recipe, RecipeContext
from .format import local_time, plural

QUIET_AFTER = timedelta(hours=24)
# Desktop apps silent for longer than this are taken to be retired.
FORGOTTEN_AFTER = timedelta(days=30)

# The synced tables that carry money or stock: what to call a record, and the
# field holding its business date.
TABLES = {
    "palay_purchases": ("palay purchase", "palay purchases", "purchase_date"),
    "sales_orders": ("sales order", "sales orders", "order_date"),
    "invoices": ("invoice", "invoices", "invoice_date"),
    "payments": ("payment", "payments", "payment_date"),
    "expenses": ("expense", "expenses", "expense_date"),
    "milling_batches": ("milling batch", "milling batches", "start_datetime"),
}


def desktop_name(client_id: str | None) -> str:
    tail = (client_id or "unknown")[-6:]
    return f"desktop app …{tail}"


def entered_offline(db: Session, first: date, last: date) -> Counter[str]:
    """Records entered on a desktop app, synced, and dated from ``first`` to
    ``last`` (their own business date, not when they synced), by table."""
    dated = or_(
        *(
            (SyncLog.table_name == table)
            & (func.substr(SyncLog.payload[field].astext, 1, 10).between(first.isoformat(), last.isoformat()))
            for table, (_, _, field) in TABLES.items()
        )
    )
    rows = (
        db.query(SyncLog.table_name, func.count(SyncLog.id))
        .filter(SyncLog.operation == "INSERT", dated)
        .group_by(SyncLog.table_name)
        .all()
    )
    return Counter({table: count for table, count in rows})


def describe_counts(counts: Counter[str]) -> str:
    parts = [plural(n, *TABLES[t][:2]) for t, n in sorted(counts.items(), key=lambda kv: -kv[1])]
    return ", ".join(parts)


def offline_note(db: Session, first: date, last: date) -> str | None:
    """The line a summary adds when work entered offline is missing from it."""
    counts = entered_offline(db, first, last)
    if not counts:
        return None
    return (
        f"Not in these figures: {describe_counts(counts)} entered on the desktop app while offline. Check them there."
    )


def quiet_desktops(db: Session, now: datetime) -> list[tuple[str | None, datetime]]:
    """Desktop apps that synced in the last month but not in the last day."""
    rows = (
        db.query(SyncLog.client_id, func.max(SyncLog.synced_at))
        .filter(SyncLog.client_id.isnot(None), SyncLog.synced_at >= now - FORGOTTEN_AFTER)
        .group_by(SyncLog.client_id)
        .all()
    )
    return sorted(
        ((client, last) for client, last in rows if now - last > QUIET_AFTER),
        key=lambda r: r[1],
    )


class FreshnessParams(BaseModel):
    email: bool = True


def _build(ctx: RecipeContext, params: BaseModel) -> list[Notice]:
    db = ctx.db
    yesterday = ctx.local_today - timedelta(days=1)
    counts = entered_offline(db, yesterday, yesterday)
    quiet = quiet_desktops(db, ctx.now)
    conflicts = db.query(func.count(SyncConflict.id)).filter(SyncConflict.resolved_at.is_(None)).scalar() or 0
    lines: list[str] = []
    if counts:
        lines.append(
            f"Entered offline for yesterday: {describe_counts(counts)}. They're on the desktop apps, "
            "not in the web app's figures, reports or these automations."
        )
    for client, last in quiet:
        lines.append(
            f"The {desktop_name(client)} hasn't synced since {local_time(last, ctx.zone)}. "
            "Anything entered on it since is only on that computer."
        )
    if conflicts:
        lines.append(f"{plural(conflicts, 'sync conflict')} waiting to be settled on a desktop app.")
    if not lines:
        return []
    return [
        Notice(
            title="Desktop app syncing: some records aren't in the web app",
            body="\n".join(lines),
            link="/settings",
            dedupe_key=f"offline_data:{ctx.local_today.isoformat()}",
        )
    ]


RECIPE_DEF = Recipe(
    code="offline_data",
    title="Desktop app syncing",
    description=(
        "Each morning, when it matters: desktop apps that haven't synced in a day, and how much was "
        "entered offline. Work entered offline isn't in the web app's figures, so you know what a summary leaves out."
    ),
    group="reports",
    section="reports",
    default_roles=("owner",),
    params=FreshnessParams,
    fields=(Field("email", "Also email it", "bool", "It always appears under the bell too."),),
    schedule=lambda _p: daily(time(7, 0)),
    build=_build,
)
