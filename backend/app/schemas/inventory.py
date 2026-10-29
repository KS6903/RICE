"""Pydantic request schemas for the inventory domain (Phase 3a).

Moved verbatim out of app/api/inventory.py — request validation is unchanged.
"""

import uuid
from decimal import Decimal

from pydantic import BaseModel


class AdjustmentIn(BaseModel):
    inventory_type: str  # palay, milled_rice, byproduct
    inventory_id: uuid.UUID
    quantity_kg: Decimal
    notes: str | None = None


class StockCreate(BaseModel):
    inventory_type: str  # palay, milled_rice, byproduct
    quantity_kg: Decimal
    branch_id: uuid.UUID | None = None
    warehouse_id: uuid.UUID | None = None  # in that branch; None: the branch's first
    variety_id: uuid.UUID | None = None  # palay + milled_rice
    grade_id: uuid.UUID | None = None  # palay
    grade_name: str | None = None  # milled_rice
    byproduct_type: str | None = None  # byproduct
