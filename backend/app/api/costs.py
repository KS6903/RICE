"""Costs/expenses domain HTTP controllers — thin routing over CostsService (Phase 3d)."""
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature
from ..repositories.costs import ExpenseCategoryRepository, ExpenseRepository
from ..schemas.costs import CategoryCreate, CategoryUpdate, ExpenseCreate
from ..services.costs_service import CostsService

router = APIRouter(dependencies=[Depends(require_feature("expenses"))])


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


@router.post("/categories", status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, svc: CostsService = Depends(get_costs_service)):
    return svc.create_category(body)


@router.put("/categories/{category_id}")
def update_category(category_id: uuid.UUID, body: CategoryUpdate, svc: CostsService = Depends(get_costs_service)):
    return svc.update_category(category_id, body)


@router.get("/expenses")
def list_expenses(skip: int = 0, limit: int = 100, svc: CostsService = Depends(get_costs_service)):
    return svc.list_expenses(skip=skip, limit=limit)


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
def create_expense(body: ExpenseCreate, svc: CostsService = Depends(get_costs_service)):
    return svc.create_expense(body)
