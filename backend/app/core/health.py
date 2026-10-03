"""Is this deployment fit to serve? The checks behind /api/health/ready and
the platform.health_watch job.

- database: answers a query
- schema: the database is at the migrations this code ships (an image newer
  than its database, or the reverse, is the classic broken deploy)
- redis: answers PING (rate limits and lockouts fall back to per-container
  memory without it, which is weaker)
- provisioning: no tenant has waited too long for its schema, and none has
  used up its retries
"""

from __future__ import annotations

from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..models.company import Company
from . import provisioning
from .cache import cache

# A tenant normally waits seconds (the Worker starts the provisioner on
# signup) or at worst one 15-minute tick; past this, something is wrong.
PROVISIONING_STUCK_AFTER = timedelta(minutes=30)

_BACKEND = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def code_heads() -> tuple[str, ...]:
    """The migration head(s) this code ships."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(_BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND / "migrations"))
    return tuple(sorted(ScriptDirectory.from_config(config).get_heads()))


def check(db: Session, *, now: datetime) -> dict[str, Any]:
    """Every check, as {"ready": bool, "checks": {name: {"ok": bool, ...}}}.
    Ready means the database answers and its schema matches the code; Redis
    and provisioning are reported but don't make this instance unready."""
    checks: dict[str, dict[str, Any]] = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = {"ok": True}
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        checks["database"] = {"ok": False, "error": type(exc).__name__}
        return {"ready": False, "checks": checks}

    expected = code_heads()
    current: tuple[str, ...]
    try:
        current = tuple(sorted(db.execute(text("SELECT version_num FROM alembic_version")).scalars()))
    except Exception:  # noqa: BLE001
        db.rollback()
        current = ()
    checks["schema"] = {"ok": current == expected, "database": list(current), "code": list(expected)}

    redis = cache.ping()
    checks["redis"] = {"ok": redis is not False, "configured": redis is not None}

    waiting = db.query(func.min(Company.provisioning_requested_at)).filter(provisioning.due(now)).scalar()
    failed = (
        db.query(func.count(Company.id))
        .filter(
            Company.provisioned_at.is_(None),
            Company.provisioning_requested_at.is_not(None),
            Company.provisioning_attempts >= provisioning.MAX_ATTEMPTS,
        )
        .scalar()
        or 0
    )
    waited = (now - waiting) if waiting else None
    checks["provisioning"] = {
        "ok": failed == 0 and (waited is None or waited <= PROVISIONING_STUCK_AFTER),
        "oldest_waiting_minutes": int(waited.total_seconds() // 60) if waited else None,
        "failed_tenants": failed,
    }
    return {"ready": checks["database"]["ok"] and checks["schema"]["ok"], "checks": checks}
