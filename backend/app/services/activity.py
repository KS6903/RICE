"""Activity logging + warehouse trash purge.

Centralises the audit-trail insert and the permanent purge of warehouses whose
30-day trash window has elapsed. Callers commit the surrounding transaction.
"""
import re
import uuid
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

# Defense-in-depth for the catalog-driven UPDATE below: even though table names
# come from information_schema (not user input), only plain snake_case
# identifiers are ever interpolated into SQL.
_SAFE_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")

from ..models.activity import ActivityLog
from ..models.base import now_utc
from ..models.company import Branch

TRASH_RETENTION_DAYS = 30


def _nullable_branch_fk_tables(db: Session) -> list[str]:
    """Discover every table with a *nullable* branch_id column from the catalog.

    Before a branch is hard-deleted we null these so the no-ON-DELETE FK
    constraints don't block the delete; their rows survive, orphaned to
    "Unassigned". NOT NULL branch_id tables (warehouse_layouts) are excluded —
    they're ON DELETE CASCADE, so they're removed with the branch row. Reading
    from information_schema keeps this correct as the schema evolves.
    """
    rows = db.execute(
        text(
            "SELECT table_name FROM information_schema.columns "
            "WHERE column_name = 'branch_id' AND is_nullable = 'YES' "
            "AND table_schema = current_schema()"
        )
    ).fetchall()
    return [r[0] for r in rows if _SAFE_IDENTIFIER.match(r[0])]


def log_activity(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    entity_label: str | None = None,
    detail: str | None = None,
) -> ActivityLog:
    """Append an audit row. Does NOT commit — the caller owns the transaction."""
    row = ActivityLog(
        company_id=company_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        detail=detail,
    )
    db.add(row)
    return row


def purge_expired_branches(db: Session, company_id: uuid.UUID) -> int:
    """Hard-delete trashed branches older than the retention window.

    Nulls referencing branch_id columns first to satisfy FK constraints, records
    a warehouse.purge activity per branch, then deletes the row (cascading its
    warehouse layout/zones/pallets). Commits its own work. Returns purge count.
    """
    cutoff = now_utc() - timedelta(days=TRASH_RETENTION_DAYS)
    expired = (
        db.query(Branch)
        .filter(Branch.company_id == company_id, Branch.deleted_at.isnot(None), Branch.deleted_at < cutoff)
        .all()
    )
    if not expired:
        return 0

    tables = _nullable_branch_fk_tables(db)
    for branch in expired:
        for table in tables:
            # nosec B608 — `table` comes from information_schema and is further
            # constrained to ^[a-z_][a-z0-9_]*$ in _nullable_branch_fk_tables();
            # the value is parameterized. Identifiers can't be bound parameters.
            db.execute(
                text(f'UPDATE "{table}" SET branch_id = NULL WHERE branch_id = :bid'),  # nosec B608
                {"bid": str(branch.id)},
            )
        log_activity(
            db,
            company_id=company_id,
            user_id=branch.deleted_by,
            action="warehouse.purge",
            entity_type="branch",
            entity_id=branch.id,
            entity_label=branch.name,
            detail="Permanently deleted after 30-day retention.",
        )
        db.delete(branch)

    db.commit()
    return len(expired)
