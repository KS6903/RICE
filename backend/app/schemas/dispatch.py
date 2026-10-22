"""Pydantic request schemas for the dispatch domain (Phase 3). Moved verbatim.

Note: canva_color_hex is intentionally omitted from create/update schemas — the
color is system-assigned, so any client-supplied value is silently dropped.
"""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AgentCreate(BaseModel):
    name: str
    agent_type: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    commission_pct: Decimal = Decimal("0")


class AgentUpdate(BaseModel):
    name: str | None = None
    agent_type: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    commission_pct: Decimal | None = None
    is_active: bool | None = None


class MillerCreate(BaseModel):
    name: str
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    capacity_kg_per_hr: Decimal | None = None
    milling_fee_per_kg: Decimal | None = None


class MillerUpdate(BaseModel):
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    capacity_kg_per_hr: Decimal | None = None
    milling_fee_per_kg: Decimal | None = None
    is_active: bool | None = None


class CourierAssign(BaseModel):
    """Who delivers an order: the customer, or the rice mill's own courier. None
    clears it. Either needs the plate number and the driver (checked by the
    service, so the refusal reads as one sentence); the phone and the note are
    optional. Nothing else is a courier, so an old client still sending an agent
    or miller is refused rather than silently clearing it."""

    model_config = ConfigDict(extra="forbid")

    courier_type: Literal["customer", "mill"] | None = None
    plate_number: str | None = Field(None, max_length=20)
    driver_name: str | None = Field(None, max_length=150)
    driver_phone: str | None = Field(None, max_length=20)
    notes: str | None = Field(None, max_length=500)
