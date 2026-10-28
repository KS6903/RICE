"""Pydantic request schemas for the warehouse-canva domain (Phase 4.1).

Moved byte-for-byte out of ``app/api/canva.py`` so the HTTP contract lives in one
place, separate from routing and business logic. Request validation is therefore
unchanged. Responses are the ``services/canva_serializers.py`` dicts, returned
directly (the zero-drift convention of ``schemas/paddy.py``).
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel

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
    variety_code: str | None = None  # convenience: lets callers use "Dinorado"
    weight_kg: float | None = None  # how many kg needed; None = every pickable pallet
    branch_id: uuid.UUID | None = None  # restrict to one branch's layout
