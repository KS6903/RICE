"""Pydantic schemas for the warehouse-canva domain (Phase 4.1).

Request models are moved byte-for-byte out of ``app/api/canva.py`` so the HTTP
contract lives in one place, separate from routing and business logic. Request
validation is therefore unchanged.

Response models mirror the ``_serialize_*`` helpers (now in
``services/canva_serializers.py``) and carry ``from_attributes=True`` so they can
validate either an ORM row or the serializer's dict. They document the wire shape;
per the project's zero-drift convention (see ``schemas/paddy.py``) the handlers
still return the serializer dicts directly, so there is no response-shape drift.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict


# ── Request models (verbatim from api/canva.py) ──────────────────────────────


class PalletMove(BaseModel):
    x_m: float
    y_m: float


class PalletResize(BaseModel):
    width_m: float
    depth_m: float


class PalletStack(BaseModel):
    parent_pallet_id: uuid.UUID


class PalletUnstack(BaseModel):
    x_m: float | None = None
    y_m: float | None = None


class LayoutPatch(BaseModel):
    name: str | None = None
    width_m: float | None = None
    height_m: float | None = None
    grid_size_m: float | None = None


class ZoneCreate(BaseModel):
    zone_type: str
    name: str
    x_m: float
    y_m: float
    width_m: float
    height_m: float
    color_hex: str | None = None
    max_weight_kg: float | None = None
    notes: str | None = None


class ZonePatch(BaseModel):
    zone_type: str | None = None
    name: str | None = None
    x_m: float | None = None
    y_m: float | None = None
    width_m: float | None = None
    height_m: float | None = None
    color_hex: str | None = None
    max_weight_kg: float | None = None
    notes: str | None = None


class LayoutCreate(BaseModel):
    name: str
    # Either pick a named preset (small/medium/large/commercial) OR supply
    # explicit width_m/height_m. Explicit values win when both are sent.
    size_preset: str | None = None
    width_m: float | None = None
    height_m: float | None = None
    grid_size_m: float = 0.5
    seed_default_zones: bool = True


class LayoutBulkDelete(BaseModel):
    ids: list[uuid.UUID]


class DispatchRecommendRequest(BaseModel):
    variety_id: uuid.UUID | None = None
    variety_code: str | None = None  # convenience: lets callers use "Rc222"
    weight_kg: float                  # how many kg needed
    branch_id: uuid.UUID | None = None  # restrict to one branch's layout


# ── Response models (document the _serialize_* helper output) ─────────────────


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class BatchOut(_Base):
    id: str
    milling_batch_id: str | None
    variety_code: str | None
    variety_name: str | None
    grade_code: str | None
    client_id: str | None
    client_type: str | None
    client_name: str | None
    sack_count: int
    weight_kg: float
    moisture_pct: float | None
    milling_date: str
    best_before_date: str | None
    days_until_expiry: int | None
    status: str
    notes: str | None


class ZoneOut(_Base):
    id: str
    zone_type: str
    name: str
    x_m: float
    y_m: float
    width_m: float
    height_m: float
    rotation_deg: float
    max_weight_kg: float | None
    color_hex: str
    notes: str | None
    is_storage: bool


class PalletOut(_Base):
    id: str
    pallet_code: str
    zone_id: str | None
    x_m: float
    y_m: float
    z_layer: int
    stack_parent_id: str | None
    width_m: float
    depth_m: float
    sack_count: int
    weight_kg: float
    status: str
    aging_status: str
    batches: list[BatchOut]


class RackPalletOut(_Base):
    id: str
    pallet_code: str
    variety_code: str | None
    variety_name: str | None
    days_old: int
    milling_date: str
    aging_status: str
    weight_kg: float
    sack_count: int
    client_name: str | None
    batches: list[BatchOut]


class MovementOut(_Base):
    id: str
    movement_type: str
    from_x_m: float | None
    from_y_m: float | None
    to_x_m: float | None
    to_y_m: float | None
    from_zone_id: str | None
    to_zone_id: str | None
    notes: str | None
    created_at: str | None


class LayoutSummaryOut(_Base):
    id: str
    name: str
    is_default: bool
    width_m: float
    height_m: float
    grid_size_m: float
    version: int
    created_at: str | None
