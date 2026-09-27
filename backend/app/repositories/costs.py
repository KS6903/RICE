"""Repositories for the costs/expenses domain (Phase 3d)."""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.costs import Expense, ExpenseCategory
from .base import BaseRepository


class ExpenseCategoryRepository(BaseRepository[ExpenseCategory]):
    model = ExpenseCategory

    def list_company_or_shared(self, company_id: uuid.UUID) -> Sequence[ExpenseCategory]:
        stmt = select(ExpenseCategory).where(
            (ExpenseCategory.company_id == company_id) | (ExpenseCategory.company_id.is_(None))
        )
        return self.db.execute(stmt.order_by(ExpenseCategory.name)).scalars().all()

    def get_by_name(self, company_id: uuid.UUID, name: str) -> ExpenseCategory | None:
        stmt = select(ExpenseCategory).where(ExpenseCategory.company_id == company_id, ExpenseCategory.name == name)
        return self.db.execute(stmt).scalars().first()


class ExpenseRepository(BaseRepository[Expense]):
    model = Expense

    def list_for_company(self, company_id: uuid.UUID, *, skip: int = 0, limit: int = 100) -> Sequence[Expense]:
        stmt = (
            select(Expense)
            .where(Expense.company_id == company_id)
            .order_by(Expense.expense_date.desc())
            .offset(skip)
            .limit(limit)
        )
        return self.db.execute(stmt).scalars().all()
