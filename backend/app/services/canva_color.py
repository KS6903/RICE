"""Tenant-wide canva color reservation.

Every party row (Customer, Supplier, Agent, Miller) carries a `canva_color_hex`
that is unique within its tenant — once a color is claimed by ANY of those four
tables for a `company_id`, no other row in any of those tables for the same
company may claim it.

Per-table uniqueness is enforced by partial unique indexes (see
`migrate_dispatch.py`). Cross-table uniqueness is enforced here at the
application layer — a single SQL constraint across four tables would require
a union table, which isn't worth the complexity at this write rate.

Public surface:
  - `PALETTE` — the canonical 30-color rotation used for auto-assignment.
  - `pick_unused_color(db, company_id)` — returns a palette color not yet
    claimed in this tenant, or a deterministic synthesized fallback if every
    palette slot is taken.
  - `colors_in_use(db, company_id, exclude=...)` — set of colors already
    claimed (helper, also used in tests).
  - `assert_color_available(db, company_id, color, *, exclude_table, exclude_id)`
    — raises HTTP 409 if another row in the tenant already claims `color`.
"""

from __future__ import annotations

import hashlib
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.dispatch import Agent, Miller
from ..models.supplier_customer import Customer, Supplier

# 30 visually distinct colors — chosen so adjacent slots have different hues
# rather than only different shades. Keeps medium tenants from collision-fallback
# even after a dozen+ parties exist.
PALETTE: tuple[str, ...] = (
    "#0ea5e9",  # sky
    "#8b5cf6",  # violet
    "#f43f5e",  # rose
    "#10b981",  # emerald
    "#f59e0b",  # amber
    "#ec4899",  # pink
    "#22d3ee",  # cyan
    "#84cc16",  # lime
    "#a855f7",  # purple
    "#ef4444",  # red
    "#14b8a6",  # teal
    "#eab308",  # yellow
    "#6366f1",  # indigo
    "#d946ef",  # fuchsia
    "#06b6d4",  # cyan-600
    "#65a30d",  # green-600
    "#dc2626",  # red-600
    "#7c3aed",  # violet-600
    "#0891b2",  # cyan-700
    "#16a34a",  # green-600
    "#c026d3",  # fuchsia-600
    "#0d9488",  # teal-600
    "#ca8a04",  # yellow-600
    "#9333ea",  # purple-600
    "#e11d48",  # rose-600
    "#059669",  # emerald-600
    "#f97316",  # orange-500
    "#2563eb",  # blue-600
    "#be123c",  # rose-700
    "#15803d",  # green-700
)


_PARTY_TABLES = (Customer, Supplier, Agent, Miller)


def _key(table: type, row_id: uuid.UUID | None) -> tuple[str, uuid.UUID | None]:
    return (table.__tablename__, row_id)


def colors_in_use(
    db: Session,
    company_id: uuid.UUID,
    *,
    exclude_table: type | None = None,
    exclude_id: uuid.UUID | None = None,
) -> set[str]:
    """Return every non-null `canva_color_hex` currently claimed by any party
    row for `company_id`. Optionally skip one specific row (for edits)."""
    used: set[str] = set()
    skip = _key(exclude_table, exclude_id) if exclude_table else None
    for table in _PARTY_TABLES:
        rows = (
            db.query(table.id, table.canva_color_hex)
            .filter(table.company_id == company_id, table.canva_color_hex.isnot(None))
            .all()
        )
        for row_id, color in rows:
            if skip is not None and _key(table, row_id) == skip:
                continue
            if color:
                used.add(color.lower())
    return used


def pick_unused_color(db: Session, company_id: uuid.UUID) -> str:
    """Pick the first palette color not already in use for `company_id`.

    If every palette slot is taken, deterministically synthesize a unique
    `#RRGGBB` from the tenant + a salt so the picker never returns None — the
    UI can still tell parties apart even past 30 entries.
    """
    used = colors_in_use(db, company_id)
    for color in PALETTE:
        if color.lower() not in used:
            return color
    # Palette exhausted — fall back to deterministic synthesis. The salt
    # increments until we miss `used`, guaranteeing termination.
    salt = 0
    while True:
        digest = hashlib.sha256(f"{company_id}:{salt}".encode()).hexdigest()[:6]
        color = f"#{digest}"
        if color.lower() not in used:
            return color
        salt += 1


def assert_color_available(
    db: Session,
    company_id: uuid.UUID,
    color: str,
    *,
    exclude_table: type | None = None,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Raise HTTP 409 if `color` is already claimed by a different party row.

    Pass `exclude_table`/`exclude_id` when editing a row so it doesn't conflict
    with itself.
    """
    used = colors_in_use(db, company_id, exclude_table=exclude_table, exclude_id=exclude_id)
    if color.lower() in used:
        raise HTTPException(
            status_code=409,
            detail=f"Color {color} is already assigned to another contact in this company. Pick a different one.",
        )


def normalize_hex(color: str | None) -> str | None:
    """Lowercase + 7-char (#rrggbb) form, or None if the input is empty."""
    if not color:
        return None
    c = color.strip().lower()
    if not c.startswith("#"):
        c = "#" + c
    return c
