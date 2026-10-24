"""Costs/expenses domain HTTP controllers — thin routing over CostsService (Phase 3d)."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..repositories.costs import ExpenseCategoryRepository, ExpenseRepository
from ..schemas.costs import CategoryCreate, CategoryUpdate, ExpenseCreate, ExpenseEdit
from ..services.activity_service import ActivityService
from ..services.costs_service import CostsService
from ..services.record_changes import require_record_editor

router = APIRouter(
    dependencies=[
        Depends(require_feature("expenses")),
        Depends(require_section_access("expenses")),
    ]
)


def get_costs_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> CostsService:
    return CostsService(
        db,
        current_user,
        categories=ExpenseCategoryRepository(db),
        expenses=ExpenseRepository(db),
    )


@router.get("/categories")
def list_categories(svc: CostsService = Depends(get_costs_service)):
    return svc.list_categories()


@router.post(
    "/categories",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("expenses", write=True))],
)
def create_category(body: CategoryCreate, svc: CostsService = Depends(get_costs_service)):
    return svc.create_category(body)


@router.put(
    "/categories/{category_id}",
    dependencies=[Depends(require_section_access("expenses", write=True))],
)
def update_category(category_id: uuid.UUID, body: CategoryUpdate, svc: CostsService = Depends(get_costs_service)):
    return svc.update_category(category_id, body)


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_section_access("expenses", write=True))],
)
def delete_category(
    category_id: uuid.UUID,
    move_to: uuid.UUID | None = None,
    svc: CostsService = Depends(get_costs_service),
):
    """Delete a category the mill added; ``move_to`` takes its expenses."""
    svc.delete_category(category_id, move_to=move_to)


@router.get("/expenses")
def list_expenses(skip: int = 0, limit: int = 100, svc: CostsService = Depends(get_costs_service)):
    return svc.list_expenses(skip=skip, limit=limit)


@router.post(
    "/expenses",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("expenses", write=True))],
)
def create_expense(body: ExpenseCreate, svc: CostsService = Depends(get_costs_service)):
    return svc.create_expense(body)


@router.patch("/expenses/{expense_id}", dependencies=[Depends(require_record_editor)])
def edit_expense(expense_id: uuid.UUID, body: ExpenseEdit, svc: CostsService = Depends(get_costs_service)):
    """Correct a saved expense (edit power), every change logged."""
    return svc.edit_expense(expense_id, body)


@router.get("/history/{entity_type}/{entity_id}")
def expense_history(
    entity_type: Literal["expense"],
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Every logged change to one expense, newest first."""
    return ActivityService(db, current_user).list_for_entity(current_user.company_id, entity_type, entity_id)
