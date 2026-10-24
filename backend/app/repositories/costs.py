"""Repositories for the costs/expenses domain (Phase 3d)."""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import func, select, update

from ..core.branch_scope import only_viewed
from ..models.costs import Expense, ExpenseCategory
from .base import BaseRepository


class ExpenseCategoryRepository(BaseRepository[ExpenseCategory]):
    model = ExpenseCategory

    def list_company_or_shared(self, company_id: uuid.UUID) -> Sequence[ExpenseCategory]:
        stmt = select(ExpenseCategory).where(
            (ExpenseCategory.company_id == company_id) | (ExpenseCategory.company_id.is_(None))
        )
        return self.db.execute(stmt.order_by(ExpenseCategory.name)).scalars().all()

    def get_by_name(
        self, company_id: uuid.UUID, name: str, *, exclude_id: uuid.UUID | None = None
    ) -> ExpenseCategory | None:
        """The category of that name, ignoring case, among the company's own and
        the shared ones (which a default may be)."""
        stmt = select(ExpenseCategory).where(
            (ExpenseCategory.company_id == company_id) | (ExpenseCategory.company_id.is_(None)),
            func.lower(ExpenseCategory.name) == name.lower(),
        )
        if exclude_id is not None:
            stmt = stmt.where(ExpenseCategory.id != exclude_id)
        return self.db.execute(stmt).scalars().first()

    def expense_counts(self, company_id: uuid.UUID) -> dict[uuid.UUID, int]:
        """How many of the company's expenses each category holds."""
        stmt = (
            select(Expense.category_id, func.count())
            .where(Expense.company_id == company_id, Expense.category_id.is_not(None))
            .group_by(Expense.category_id)
        )
        return {category_id: count for category_id, count in self.db.execute(stmt).all() if category_id is not None}

    def move_expenses(self, from_id: uuid.UUID, to_id: uuid.UUID) -> None:
        self.db.execute(update(Expense).where(Expense.category_id == from_id).values(category_id=to_id))


class ExpenseRepository(BaseRepository[Expense]):
    model = Expense

    def list_for_company(self, company_id: uuid.UUID, *, skip: int = 0, limit: int = 100) -> Sequence[Expense]:
        stmt = (
            only_viewed(select(Expense).where(Expense.company_id == company_id), Expense.branch_id, self.db)
            .order_by(Expense.expense_date.desc())
            .offset(skip)
            .limit(limit)
        )
        return self.db.execute(stmt).scalars().all()
