"""Who may correct a saved record, and the field-by-field log of every edit.

Each saved edit to a record (a sales order, an invoice, a customer) writes one
Activity Log row: who, when, which record, and every field that changed, from
the old value to the new one, one per line. Nothing is logged when nothing
changed. The log row is written in the same transaction as the edit, so an
edit is never saved without its record of what changed.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from .activity import log_activity

BLANK = "blank"


def can_edit_saved_records(user: Any) -> bool:
    """The Boss can correct any saved record."""
    role = getattr(user, "role", None)
    return bool(role is not None and role.name == "owner")


def require_record_editor(current_user=Depends(get_current_user)):
    """Dependency for the edit-a-saved-record routes."""
    if not can_edit_saved_records(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the Boss can edit saved records.")
    return current_user


def show(value: Any) -> str:
    """A value as the log shows it: money and kilos without trailing zeros,
    dates as written, blanks as "blank"."""
    if value is None or value == "":
        return BLANK
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, Decimal):
        text = f"{value:,.2f}"
        return text[:-3] if text.endswith(".00") else text
    if isinstance(value, float):
        return show(Decimal(str(value)))
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def changed_fields(before: Mapping[str, Any], after: Mapping[str, Any], labels: Mapping[str, str]) -> list[str]:
    """One "Label: old → new" line per field in labels whose shown value changed."""
    lines = []
    for key, label in labels.items():
        old, new = show(before.get(key)), show(after.get(key))
        if old != new:
            lines.append(f"{label}: {old} → {new}")
    return lines


def log_changes(
    db: Session,
    *,
    user: Any,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    entity_label: str | None,
    lines: list[str],
) -> None:
    """Write the edit's log row (in the caller's transaction). No lines, no row."""
    if not lines:
        return
    log_activity(
        db,
        company_id=user.company_id,
        user_id=user.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        detail="\n".join(lines),
    )
