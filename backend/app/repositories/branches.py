"""Repository for the branches domain (Phase 3)."""
from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.company import Branch
from .base import BaseRepository


class BranchRepository(BaseRepository[Branch]):
    model = Branch

    def list_live_for_company(self, company_id: uuid.UUID) -> Sequence[Branch]:
        stmt = select(Branch).where(
            Branch.company_id == company_id, Branch.deleted_at.is_(None)
        )
        return self.db.execute(stmt).scalars().all()

    def list_trashed_for_company(self, company_id: uuid.UUID) -> Sequence[Branch]:
        stmt = (
            select(Branch)
            .where(Branch.company_id == company_id, Branch.deleted_at.isnot(None))
            .order_by(Branch.deleted_at.desc())
        )
        return self.db.execute(stmt).scalars().all()

    def count_for_company(self, company_id: uuid.UUID) -> int:
        """Counts ALL branches (live + trashed) — drives the multi-branch gate."""
        return self.db.query(Branch).filter(Branch.company_id == company_id).count()
