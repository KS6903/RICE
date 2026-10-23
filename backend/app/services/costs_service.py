"""CostsService — business logic for the costs/expenses domain (Phase 3d)."""

from __future__ import annotations

import uuid
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, ConflictError, NotFoundError
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

    def list_categories(self) -> list[dict]:
        counts = self.categories.expense_counts(self.current_user.company_id)
        return [
            _category_out(c, counts.get(c.id, 0))
            for c in self.categories.list_company_or_shared(self.current_user.company_id)
        ]

    def create_category(self, data) -> dict:
        name = self._free_name(data.name)
        cat = ExpenseCategory(
            company_id=self.current_user.company_id, name=name, is_production_cost=data.is_production_cost
        )
        with self.transaction():
            self.categories.add(cat)
        self.db.refresh(cat)
        return _category_out(cat, 0)

    def update_category(self, category_id: uuid.UUID, data) -> dict:
        """Rename a category or change its type. A default can be edited too."""
        cat = self._own_category(category_id)
        with self.transaction():
            if data.name is not None:
                cat.name = self._free_name(data.name, exclude_id=cat.id)
            if data.is_production_cost is not None:
                cat.is_production_cost = data.is_production_cost
        self.db.refresh(cat)
        return _category_out(cat, self.categories.expense_counts(self.current_user.company_id).get(cat.id, 0))

    def delete_category(self, category_id: uuid.UUID, *, move_to: uuid.UUID | None = None) -> None:
        """Delete a category the mill added. Its expenses, if any, move to
        *move_to* first; a default category stays."""
        cat = self._own_category(category_id)
        if cat.is_default:
            raise ConflictError(
                "A default category can't be deleted. You can rename it or change its type.",
                code="category_is_default",
            )
        in_use = self.categories.expense_counts(self.current_user.company_id).get(cat.id, 0)
        if in_use and move_to is None:
            raise ConflictError(
                f"{in_use} expense(s) are filed under {cat.name}. Choose a category to move them to.",
                code="category_in_use",
            )
        with self.transaction():
            if in_use:
                target = self._own_category(move_to, label="The category to move them to")
                if target.id == cat.id:
                    raise BadRequestError("Choose a different category to move the expenses to.")
                self.categories.move_expenses(cat.id, target.id)
            self.categories.delete(cat)

    def _own_category(self, category_id, *, label: str = "Category") -> ExpenseCategory:
        """One of this mill's categories (its own, or a shared row in its schema)."""
        cat = self.categories.get(category_id)
        if not cat or cat.company_id not in (self.current_user.company_id, None):
            raise NotFoundError(f"{label} not found")
        return cat

    def _free_name(self, name: str, *, exclude_id: uuid.UUID | None = None) -> str:
        name = name.strip()
        if not name:
            raise BadRequestError("Give the category a name.")
        if self.categories.get_by_name(self.current_user.company_id, name, exclude_id=exclude_id):
            raise ConflictError(f"Category '{name}' already exists", code="category_exists")
        return name

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


def _category_out(cat: ExpenseCategory, expense_count: int) -> dict:
    return {
        "id": str(cat.id),
        "company_id": str(cat.company_id) if cat.company_id else None,
        "name": cat.name,
        "is_production_cost": cat.is_production_cost,
        "is_default": cat.is_default,
        "expense_count": expense_count,
    }
