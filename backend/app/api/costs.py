import uuid
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.costs import Expense, ExpenseCategory

router = APIRouter()


class CategoryCreate(BaseModel):
    name: str
    is_production_cost: bool = True


class CategoryUpdate(BaseModel):
    name: str | None = None
    is_production_cost: bool | None = None


class ExpenseCreate(BaseModel):
    category_id: uuid.UUID
    batch_id: uuid.UUID | None = None
    expense_date: date
    amount: Decimal
    description: str | None = None
    reference_no: str | None = None


@router.get("/categories")
def list_categories(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(ExpenseCategory).filter(
        (ExpenseCategory.company_id == current_user.company_id) | (ExpenseCategory.company_id.is_(None))
    ).order_by(ExpenseCategory.name).all()


@router.post("/categories", status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(ExpenseCategory).filter(
        ExpenseCategory.company_id == current_user.company_id,
        ExpenseCategory.name == body.name,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Category '{body.name}' already exists")
    cat = ExpenseCategory(company_id=current_user.company_id, **body.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/categories/{category_id}")
def update_category(category_id: uuid.UUID, body: CategoryUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    cat = db.get(ExpenseCategory, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if cat.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Cannot edit shared/system categories. Create your own copy.")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(cat, field, val)
    db.commit()
    db.refresh(cat)
    return cat


@router.get("/expenses")
def list_expenses(skip: int = 0, limit: int = 100, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Expense).filter(
        Expense.company_id == current_user.company_id
    ).order_by(Expense.expense_date.desc()).offset(skip).limit(limit).all()


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
def create_expense(body: ExpenseCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    expense = Expense(
        company_id=current_user.company_id,
        branch_id=current_user.branch_id,
        created_by=current_user.id,
        **body.model_dump()
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense
