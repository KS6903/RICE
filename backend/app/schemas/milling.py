"""Pydantic request schemas for the milling domain (Phase 3c). Moved verbatim."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Custom milling: what the client and the mill agreed. Only mill_keeps_byproducts
# puts anything into the mill's stock (the ipa and darak).
ClientArrangement = Literal["client_takes_all", "mill_keeps_byproducts", "contracted"]


class BatchInputIn(BaseModel):
    variety_id: uuid.UUID | None = None
    grade_id: uuid.UUID | None = None
    input_weight_kg: Decimal
    moisture_content_pct: Decimal | None = None


class BatchOutputIn(BaseModel):
    output_type: str  # milled_rice, ipa, darak, binlid
    variety_id: uuid.UUID | None = None
    output_weight_kg: Decimal
    broken_rice_pct: Decimal | None = None
    grade_name: str | None = None


class BatchCreate(BaseModel):
    equipment_id: uuid.UUID | None = None
    operator_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    client_arrangement: ClientArrangement | None = None
    client_notes: str | None = Field(default=None, max_length=1000)
    start_datetime: datetime
    remarks: str | None = None
    inputs: list[BatchInputIn]
    outputs: list[BatchOutputIn] = []


class BatchEdit(BaseModel):
    """A correction to a saved batch, by someone with edit power
    (services/record_changes.py). Only the fields sent change; inputs or
    outputs sent replace the old ones, and stock follows."""

    equipment_id: uuid.UUID | None = None
    operator_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    client_arrangement: ClientArrangement | None = None
    client_notes: str | None = Field(default=None, max_length=1000)
    start_datetime: datetime | None = None
    end_datetime: datetime | None = None
    remarks: str | None = Field(default=None, max_length=2000)
    inputs: list[BatchInputIn] | None = Field(default=None, min_length=1)
    outputs: list[BatchOutputIn] | None = None


class ClientCreate(BaseModel):
    """A walk-in client for custom milling: who they are and how to reach them."""

    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=20)
    address: str | None = Field(default=None, max_length=500)

    @field_validator("name", "phone")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("is required")
        return value


class EquipmentCreate(BaseModel):
    name: str
    model: str | None = None
    capacity_kg_per_hr: Decimal | None = None


class EquipmentUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    capacity_kg_per_hr: Decimal | None = None
    is_active: bool | None = None
