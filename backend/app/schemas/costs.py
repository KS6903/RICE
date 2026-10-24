"""Pydantic request schemas for the costs/expenses domain (Phase 3d). Moved verbatim."""

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str
    is_production_cost: bool = True


class CategoryUpdate(BaseModel):
    name: str | None = None
    is_production_cost: bool | None = None


class ExpenseEdit(BaseModel):
    """A correction to a saved expense, by someone with edit power
    (services/record_changes.py). Only the fields sent change."""

    category_id: uuid.UUID | None = None
    batch_id: uuid.UUID | None = None
    expense_date: date | None = None
    amount: Decimal | None = None
    description: str | None = Field(None, max_length=2000)
    reference_no: str | None = Field(None, max_length=50)


class ExpenseCreate(BaseModel):
    category_id: uuid.UUID
    batch_id: uuid.UUID | None = None
    expense_date: date
    amount: Decimal
    description: str | None = None
    reference_no: str | None = None
