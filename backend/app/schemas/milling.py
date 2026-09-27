"""Pydantic request schemas for the milling domain (Phase 3c). Moved verbatim."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


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
    start_datetime: datetime
    remarks: str | None = None
    inputs: list[BatchInputIn]
    outputs: list[BatchOutputIn] = []


class EquipmentCreate(BaseModel):
    name: str
    model: str | None = None
    capacity_kg_per_hr: Decimal | None = None


class EquipmentUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    capacity_kg_per_hr: Decimal | None = None
    is_active: bool | None = None
