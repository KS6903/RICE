"""Pydantic request schemas for the dispatch domain (Phase 3). Moved verbatim.

Note: canva_color_hex is intentionally omitted from create/update schemas — the
color is system-assigned, so any client-supplied value is silently dropped.
"""
import uuid
from decimal import Decimal

from pydantic import BaseModel


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
    agent_id: uuid.UUID | None = None
    miller_id: uuid.UUID | None = None
