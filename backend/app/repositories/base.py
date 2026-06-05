"""Generic repository base — the data-access layer for the OOP refactor (Phase 1).

A repository encapsulates ``db.query(...)`` so services and routes don't talk to
the ORM session directly. Two cross-cutting concerns are handled here once:

* **Soft delete** — models that carry a ``deleted_at`` column are filtered to live
  rows by default (``include_deleted=True`` to bypass).
* **Tenant scope** — ``*_for_company`` helpers constrain by ``company_id``.

Transaction rule (important): repositories ``add``/``flush`` only — they NEVER
commit. The owning *service* commits or rolls back. This makes multi-step writes
atomic and gives one clear place that owns the transaction boundary.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Generic, Sequence, Type, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.database import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    """CRUD + soft-delete-aware querying for a single ORM model.

    Subclass and set ``model``::

        class SupplierRepository(BaseRepository[Supplier]):
            model = Supplier
    """

    model: Type[ModelT]

    def __init__(self, db: Session) -> None:
        self.db = db

    # ---- query building -------------------------------------------------------

    def _supports_soft_delete(self) -> bool:
        return hasattr(self.model, "deleted_at")

    def _base_query(self, *, include_deleted: bool = False):
        """A SELECT over the model, excluding soft-deleted rows by default."""
        stmt = select(self.model)
        if not include_deleted and self._supports_soft_delete():
            stmt = stmt.where(self.model.deleted_at.is_(None))  # type: ignore[attr-defined]
        return stmt

    # ---- reads ----------------------------------------------------------------

    def get(self, id: Any, *, include_deleted: bool = False) -> ModelT | None:
        """Fetch by primary key, respecting soft-delete unless asked otherwise."""
        obj = self.db.get(self.model, id)
        if obj is None:
            return None
        if not include_deleted and self._supports_soft_delete() and obj.deleted_at is not None:  # type: ignore[attr-defined]
            return None
        return obj

    def get_for_company(self, id: Any, company_id: uuid.UUID, *, include_deleted: bool = False) -> ModelT | None:
        """Tenant-safe get: returns None if the row belongs to another company."""
        obj = self.get(id, include_deleted=include_deleted)
        if obj is None:
            return None
        if getattr(obj, "company_id", None) != company_id:
            return None
        return obj

    def list(
        self,
        *,
        where: Sequence[Any] | None = None,
        order_by: Any = None,
        skip: int = 0,
        limit: int | None = None,
        include_deleted: bool = False,
    ) -> Sequence[ModelT]:
        """Generic list with optional filters, ordering, and pagination."""
        stmt = self._base_query(include_deleted=include_deleted)
        if where:
            for clause in where:
                stmt = stmt.where(clause)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        if skip:
            stmt = stmt.offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return self.db.execute(stmt).scalars().all()

    # Note: tenant-scoped listing with domain filters lives on each concrete
    # repository (e.g. SupplierRepository.list_for_company), not here — the base
    # stays generic so subclasses can choose their own list signatures.

    # ---- writes (flush only, never commit) ------------------------------------

    def add(self, obj: ModelT) -> ModelT:
        """Stage a new row and flush so its PK/defaults populate. No commit."""
        self.db.add(obj)
        self.db.flush()
        return obj

    def delete(self, obj: ModelT) -> None:
        """Hard delete. No commit."""
        self.db.delete(obj)
        self.db.flush()

    def soft_delete(self, obj: ModelT) -> None:
        """Mark a row deleted (model must have ``deleted_at``). No commit."""
        if not self._supports_soft_delete():
            raise AttributeError(f"{self.model.__name__} has no deleted_at column")
        obj.deleted_at = datetime.now(timezone.utc)  # type: ignore[attr-defined]
        self.db.flush()
