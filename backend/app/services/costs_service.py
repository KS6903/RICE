"""CostsService — business logic for the costs/expenses domain (Phase 3d)."""

from __future__ import annotations

import uuid
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ..core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from ..models.costs import Expense, ExpenseCategory
from ..models.milling import MillingBatch
from ..repositories.costs import ExpenseCategoryRepository, ExpenseRepository
from ..services.base import BaseService


class CostsService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        categories: ExpenseCategoryRepository,
        expenses: ExpenseRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.categories = categories
        self.expenses = expenses

    # ── categories ────────────────────────────────────────────────────────────

    def list_categories(self) -> Sequence[ExpenseCategory]:
        return self.categories.list_company_or_shared(self.current_user.company_id)

    def create_category(self, data) -> ExpenseCategory:
        if self.categories.get_by_name(self.current_user.company_id, data.name):
            raise ConflictError(f"Category '{data.name}' already exists", code="category_exists")
        cat = ExpenseCategory(company_id=self.current_user.company_id, **data.model_dump())
        with self.transaction():
            self.categories.add(cat)
        self.db.refresh(cat)
        return cat

    def update_category(self, category_id: uuid.UUID, data) -> ExpenseCategory:
        cat = self.categories.get(category_id)
        if not cat:
            raise NotFoundError("Category not found")
        if cat.company_id != self.current_user.company_id:
            raise PermissionDeniedError("Cannot edit shared/system categories. Create your own copy.")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(cat, field, val)
        self.db.refresh(cat)
        return cat

    # ── expenses ──────────────────────────────────────────────────────────────

    def list_expenses(self, *, skip: int = 0, limit: int = 100) -> Sequence[Expense]:
        return self.expenses.list_for_company(self.current_user.company_id, skip=skip, limit=limit)

    def create_expense(self, data) -> Expense:
        # IDOR guards: the category must be ours or shared; an attached milling
        # batch must be ours.
        self.assert_company_fk(ExpenseCategory, data.category_id, label="Category", allow_shared=True)
        self.assert_company_fk(MillingBatch, data.batch_id, label="Batch")
        expense = Expense(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            created_by=self.current_user.id,
            **data.model_dump(),
        )
        with self.transaction():
            self.expenses.add(expense)
        self.db.refresh(expense)
        return expense
