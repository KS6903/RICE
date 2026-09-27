"""Service-layer base — owns the transaction boundary (Phase 1 of the refactor).

Services hold business logic and orchestrate repositories. Unlike the old
module-level service functions (which left commit/flush responsibility ambiguous),
a service OWNS its transaction via the ``transaction()`` context manager:
everything inside commits together or rolls back together.

Per-domain services subclass this and are constructed with their repositories.
A small FastAPI ``Depends`` factory wires them per request (see each domain's
``get_<domain>_service``) — we deliberately keep FastAPI's DI, no IoC container.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError


class BaseService:
    def __init__(self, db: Session, current_user: Any | None = None) -> None:
        self.db = db
        # Typed Any: it's the authenticated ORM User (or None for system tasks);
        # services access its attributes freely without per-attribute guards.
        self.current_user: Any = current_user

    def assert_company_fk(self, model, fk_id, *, label: str, allow_shared: bool = False) -> None:
        """Validate a client-supplied foreign key references a row the caller's
        company may use. IDOR guard: without this, a request can attach another
        tenant's row (customer, branch, category, …) by guessing/leaking its id.

        ``allow_shared=True`` additionally accepts system rows (company_id IS
        NULL — e.g. the shared rice-variety catalog). Rows from other companies
        always read as "not found" (404), never as "forbidden", to avoid leaking
        the id's existence.
        """
        if fk_id is None:
            return
        obj = self.db.get(model, fk_id)
        if obj is not None:
            company_id = getattr(obj, "company_id", None)
            if company_id == self.current_user.company_id or (allow_shared and company_id is None):
                return
        raise NotFoundError(f"{label} not found")

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Run a unit of work atomically: commit on success, roll back on error.

        Repositories only flush; this is the single place that commits, so a
        multi-step write (e.g. a purchase + its inventory movements) is all-or-
        nothing.
        """
        try:
            yield
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
