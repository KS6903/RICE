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
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# ── Varieties ────────────────────────────────────────────────────────────────


class VarietyCreate(BaseModel):
    code: str
    name: str
    category: str | None = None
    # The list it joins: the Palay pages' or the Rice pages'. Fixed once made.
    kind: Literal["palay", "rice"] = "rice"
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
    """One line of a palay purchase. Counted in sacks; the cavans and kilos are
    optional, and when the kilos weren't weighed they come from the cavans, or
    else the sacks (50 kg each). A wet line may carry the weight and moisture
    after drying now, or have them recorded once it is dry."""

    variety_id: uuid.UUID | None = None
    grade_id: uuid.UUID | None = None
    sack_count: Decimal | None = Field(None, gt=0)
    cavan_count: Decimal | None = Field(None, gt=0)
    gross_weight_kg: Decimal | None = None
    tare_weight_kg: Decimal = Decimal("0")
    moisture_content_pct: Decimal | None = None
    price_per_cavan: Decimal
    is_wet: bool = False
    dried_weight_kg: Decimal | None = Field(None, gt=0)
    dried_moisture_pct: Decimal | None = Field(None, ge=0, le=100)

    @model_validator(mode="after")
    def _counted(self) -> "PurchaseItemIn":
        if self.gross_weight_kg is None and self.cavan_count is None and self.sack_count is None:
            raise ValueError("Give the sacks, cavans or kilos bought.")
        if not self.is_wet and (self.dried_weight_kg is not None or self.dried_moisture_pct is not None):
            raise ValueError("Only wet palay has a weight and moisture after drying.")
        return self


class DriedIn(BaseModel):
    """The result of drying one wet line: what it weighs now, and its moisture."""

    dried_weight_kg: Decimal = Field(gt=0)
    dried_moisture_pct: Decimal | None = Field(None, ge=0, le=100)


class RecoveryIn(BaseModel):
    """A milling-recovery test on a purchase's palay: the sample weighed in and
    what came out of it. The recovery is worked out here, never taken from the
    client. Head rice is part of the milled rice, which includes its brokens."""

    variety_id: uuid.UUID | None = None
    # Kilos to the milligram: the screen takes kilos or grams and sends kilos.
    sample_kg: Decimal = Field(gt=0, max_digits=12, decimal_places=6)
    sample_moisture_pct: Decimal | None = Field(None, ge=0, le=100)
    milled_kg: Decimal = Field(gt=0, max_digits=12, decimal_places=6)
    head_rice_kg: Decimal | None = Field(None, ge=0, max_digits=12, decimal_places=6)
    husk_kg: Decimal | None = Field(None, ge=0, max_digits=12, decimal_places=6)
    bran_kg: Decimal | None = Field(None, ge=0, max_digits=12, decimal_places=6)

    @model_validator(mode="after")
    def _adds_up(self) -> "RecoveryIn":
        if self.milled_kg > self.sample_kg:
            raise ValueError("The milled rice can't weigh more than the palay it came from.")
        if self.head_rice_kg is not None and self.head_rice_kg > self.milled_kg:
            raise ValueError("The head rice is part of the milled rice, so it can't weigh more than it.")
        for part in (self.husk_kg, self.bran_kg):
            if part is not None and part > self.sample_kg:
                raise ValueError("The husk and the bran can't weigh more than the palay they came from.")
        return self


class StockViewIn(BaseModel):
    view: Literal["sacks", "cavans", "kilos", "all"]


class PurchaseCreate(BaseModel):
    supplier_id: uuid.UUID | None = None
    # The warehouse the palay is stored in. None: the recorder's own warehouse.
    # Only an owner or admin may pick a different one.
    branch_id: uuid.UUID | None = None
    # The warehouse in that branch; None: the branch's first.
    warehouse_id: uuid.UUID | None = None
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
