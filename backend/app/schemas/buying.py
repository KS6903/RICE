"""Request schemas for rice and by-product purchases (models/buying.py).

Shaped like PurchaseCreate for palay (schemas/paddy.py), minus what doesn't
apply: no tare and no moisture. Rice lines count sacks; by-product lines weigh.
"""

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


def _blank_to_none(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


class RicePurchaseItemIn(BaseModel):
    variety_id: uuid.UUID | None = None
    grade_name: str | None = Field(None, max_length=30)  # Graded Rice, Straight Mill Rice, Broken Rice, ...
    sack_count: Decimal = Field(gt=0)
    kg_per_sack: Decimal = Field(Decimal("50"), gt=0, le=1000)
    price_per_sack: Decimal = Field(ge=0)

    _grade = field_validator("grade_name")(_blank_to_none)


class RicePurchaseCreate(BaseModel):
    supplier_id: uuid.UUID | None = None
    # The warehouse the rice is stored in. None: the recorder's own warehouse.
    # Only an owner or admin may pick a different one.
    branch_id: uuid.UUID | None = None
    # The warehouse in that branch; None: the branch's first.
    warehouse_id: uuid.UUID | None = None
    purchase_date: date
    delivery_type: str | None = Field(None, max_length=20)
    remarks: str | None = Field(None, max_length=2000)
    items: list[RicePurchaseItemIn] = Field(min_length=1)


class ByproductPurchaseItemIn(BaseModel):
    byproduct_type: str = Field(min_length=1, max_length=20)  # ipa, darak, binlid, …
    weight_kg: Decimal = Field(gt=0)
    price_per_kg: Decimal = Field(ge=0)

    @field_validator("byproduct_type")
    @classmethod
    def _type(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("Pick the by-product.")
        return v


class ByproductPurchaseCreate(BaseModel):
    supplier_id: uuid.UUID | None = None
    branch_id: uuid.UUID | None = None
    warehouse_id: uuid.UUID | None = None
    purchase_date: date
    delivery_type: str | None = Field(None, max_length=20)
    remarks: str | None = Field(None, max_length=2000)
    items: list[ByproductPurchaseItemIn] = Field(min_length=1)


class RicePurchaseEdit(BaseModel):
    """A correction to a saved rice purchase, by someone with edit power. Only
    the fields sent change; lines sent replace the old ones, and stock follows."""

    supplier_id: uuid.UUID | None = None
    purchase_date: date | None = None
    delivery_type: str | None = Field(None, max_length=20)
    remarks: str | None = Field(None, max_length=2000)
    items: list[RicePurchaseItemIn] | None = Field(None, min_length=1)


class ByproductPurchaseEdit(BaseModel):
    """As RicePurchaseEdit, for a by-product purchase."""

    supplier_id: uuid.UUID | None = None
    purchase_date: date | None = None
    delivery_type: str | None = Field(None, max_length=20)
    remarks: str | None = Field(None, max_length=2000)
    items: list[ByproductPurchaseItemIn] | None = Field(None, min_length=1)
