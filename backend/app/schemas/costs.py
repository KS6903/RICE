"""Pydantic request schemas for the costs/expenses domain (Phase 3d). Moved verbatim."""

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


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
