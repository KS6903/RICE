"""Pydantic request schemas for the paddy domain.

Moved out of app/api/paddy.py as part of the OOP refactor (Phase 2.1) so the
HTTP contract lives in one place, separate from routing and business logic.
These are byte-for-byte the same models that were previously inline, so request
validation is unchanged.

Response serialization is intentionally left as-is for now (handlers return ORM
objects / hand-built dicts) to guarantee zero response-shape drift; explicit
response models can be adopted later behind the characterization tests.
"""

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field

# ── Varieties ────────────────────────────────────────────────────────────────


class VarietyCreate(BaseModel):
    code: str
    name: str
    category: str | None = None
    typical_recovery_pct: Decimal | None = None


class VarietyUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    category: str | None = None
    typical_recovery_pct: Decimal | None = None
    is_active: bool | None = None


# ── Grades ───────────────────────────────────────────────────────────────────


class GradeCreate(BaseModel):
    code: str
    name: str | None = None


# ── Suppliers ────────────────────────────────────────────────────────────────


class SupplierCreate(BaseModel):
    supplier_type: str | None = None
    name: str
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    municipality: str | None = None
    province: str | None = None
    farmer_id: str | None = None


class SupplierUpdate(BaseModel):
    supplier_type: str | None = None
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    municipality: str | None = None
    province: str | None = None
    farmer_id: str | None = None
    is_active: bool | None = None


# ── Purchases ────────────────────────────────────────────────────────────────


class PurchaseItemIn(BaseModel):
    variety_id: uuid.UUID | None = None
    grade_id: uuid.UUID | None = None
    gross_weight_kg: Decimal
    tare_weight_kg: Decimal = Decimal("0")
    moisture_content_pct: Decimal | None = None
    price_per_cavan: Decimal


class PurchaseCreate(BaseModel):
    supplier_id: uuid.UUID | None = None
    # The warehouse the palay is stored in. None: the recorder's own warehouse.
    # Only an owner or admin may pick a different one.
    branch_id: uuid.UUID | None = None
    purchase_date: date
    delivery_type: str | None = None
    remarks: str | None = None
    items: list[PurchaseItemIn]


class PurchaseEdit(BaseModel):
    """A correction to a saved palay purchase, by someone with edit power
    (services/record_changes.py). Only the fields sent change; lines sent
    replace the old ones, and the palay stock follows."""

    supplier_id: uuid.UUID | None = None
    purchase_date: date | None = None
    delivery_type: str | None = Field(None, max_length=20)
    remarks: str | None = Field(None, max_length=2000)
    items: list[PurchaseItemIn] | None = Field(None, min_length=1)


class PurchaseUpdate(BaseModel):
    """Replaces the old untyped ``body: dict`` on PUT /purchases/{id} — only
    these fields are updatable; anything else fails validation instead of
    silently reaching the service layer."""

    status: str | None = Field(None, max_length=30)
    remarks: str | None = Field(None, max_length=2000)
    delivery_type: str | None = Field(None, max_length=30)
