"""Pure serializers + zone taxonomy for the warehouse-canva domain (Phase 4.3).

These functions are moved byte-for-byte from ``api/canva.py`` (the old
``_serialize_*`` / ``_is_storage_zone`` / ``_default_*`` helpers). They take ORM
rows and return the exact same dict shapes, so the wire contract is unchanged.
No DB access — every service shares these for response building.
"""

from __future__ import annotations

from datetime import date

from ..models.warehouse import Pallet, PalletMovement, RiceBatch, WarehouseLayout, WarehouseZone
from .rice_shelf_life import days_until_expiry

# Worst (most aged) status drives a pallet's color.
_AGING_RANK = {"expired": 3, "critical": 2, "warning": 1, "fresh": 0}

# Structural elements: visual-only, cannot hold pallets. Drag-validation rejects
# moves that land on these. Anything not listed here is treated as storage.
STRUCTURAL_ZONE_TYPES = {"wall", "door", "walkway", "loading_dock"}

# All allowed zone_type values. Frontend uses this to populate dropdowns.
ALLOWED_ZONE_TYPES = [
    # storage
    "general",
    "milling",
    "premium_storage",
    "customer_storage",
    "paddy_intake",
    "drying",
    "shipping_dock",
    "office",
    # structural
    "wall",
    "door",
    "walkway",
    "loading_dock",
]


def is_storage_zone(zone_type: str) -> bool:
    return zone_type not in STRUCTURAL_ZONE_TYPES


def serialize_zone(z: WarehouseZone) -> dict:
    return {
        "id": str(z.id),
        "zone_type": z.zone_type,
        "name": z.name,
        "x_m": float(z.x_m),
        "y_m": float(z.y_m),
        "width_m": float(z.width_m),
        "height_m": float(z.height_m),
        "rotation_deg": float(z.rotation_deg),
        "max_weight_kg": float(z.max_weight_kg) if z.max_weight_kg else None,
        "color_hex": z.color_hex,
        "notes": z.notes,
        "is_storage": is_storage_zone(z.zone_type),
    }


def serialize_batch(b: RiceBatch, today: date) -> dict:
    return {
        "id": str(b.id),
        "milling_batch_id": str(b.milling_batch_id) if b.milling_batch_id else None,
        "variety_code": b.variety.code if b.variety else None,
        "variety_name": b.variety.name if b.variety else None,
        "grade_code": b.grade.code if b.grade else None,
        "client_id": str(b.client_id) if b.client_id else None,
        "client_type": b.client_type,
        "client_name": b.client_name,
        "sack_count": b.sack_count,
        "weight_kg": float(b.weight_kg),
        "moisture_pct": float(b.moisture_pct) if b.moisture_pct else None,
        "milling_date": b.milling_date.isoformat(),
        "best_before_date": b.best_before_date.isoformat() if b.best_before_date else None,
        "days_until_expiry": days_until_expiry(b.milling_date, b.moisture_pct, today),
        "status": b.status,
        "notes": b.notes,
    }


def serialize_pallet(p: Pallet, today: date) -> dict:
    # Worst (most aged) status across all batches drives the pallet color
    statuses = [b.status for b in p.batches]
    worst = max(statuses, key=lambda s: _AGING_RANK.get(s, 0)) if statuses else "fresh"
    return {
        "id": str(p.id),
        "pallet_code": p.pallet_code,
        "zone_id": str(p.zone_id) if p.zone_id else None,
        "x_m": float(p.x_m),
        "y_m": float(p.y_m),
        "z_layer": p.z_layer,
        "stack_parent_id": str(p.stack_parent_id) if p.stack_parent_id else None,
        "width_m": float(p.width_m),
        "depth_m": float(p.depth_m),
        "sack_count": p.sack_count,
        "weight_kg": float(p.weight_kg),
        "status": p.status,
        "aging_status": worst,
        "batches": [serialize_batch(b, today) for b in p.batches],
    }


def serialize_rack_pallet(p: Pallet, today: date) -> dict:
    """Slim pallet shape for the rack/grid list — variety/aging/client only.

    Unlike serialize_pallet this drops x/y/stacking/dimensions (irrelevant to a
    list view) and folds the batches down to the fields the rack rows show.
    """
    statuses = [b.status for b in p.batches]
    worst = max(statuses, key=lambda s: _AGING_RANK.get(s, 0)) if statuses else "fresh"
    # Earliest milling date drives "days old" (oldest batch on the pallet → FIFO)
    milling_dates = [b.milling_date for b in p.batches if b.milling_date]
    earliest = min(milling_dates) if milling_dates else today
    first = p.batches[0] if p.batches else None
    return {
        "id": str(p.id),
        "pallet_code": p.pallet_code,
        "variety_code": first.variety.code if first and first.variety else None,
        "variety_name": first.variety.name if first and first.variety else None,
        "days_old": (today - earliest).days,
        "milling_date": earliest.isoformat(),
        "aging_status": worst,
        "weight_kg": float(p.weight_kg),
        "sack_count": p.sack_count,
        "client_name": first.client_name if first else None,
        # Full batch breakdown powers the pallet detail panel (no extra fetch).
        "batches": [serialize_batch(b, today) for b in p.batches],
    }


def serialize_movement(m: PalletMovement) -> dict:
    return {
        "id": str(m.id),
        "movement_type": m.movement_type,
        "from_x_m": float(m.from_x_m) if m.from_x_m is not None else None,
        "from_y_m": float(m.from_y_m) if m.from_y_m is not None else None,
        "to_x_m": float(m.to_x_m) if m.to_x_m is not None else None,
        "to_y_m": float(m.to_y_m) if m.to_y_m is not None else None,
        "from_zone_id": str(m.from_zone_id) if m.from_zone_id else None,
        "to_zone_id": str(m.to_zone_id) if m.to_zone_id else None,
        "notes": m.notes,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def serialize_layout_summary(layout: WarehouseLayout) -> dict:
    return {
        "id": str(layout.id),
        "name": layout.name,
        "is_default": layout.is_default,
        "width_m": float(layout.width_m),
        "height_m": float(layout.height_m),
        "grid_size_m": float(layout.grid_size_m),
        "version": layout.version,
        "created_at": layout.created_at.isoformat() if layout.created_at else None,
    }


def default_color_for(zone_type: str) -> str:
    return {
        "milling": "#94a3b8",
        "premium_storage": "#10b981",
        "customer_storage": "#0ea5e9",
        "general": "#a3a3a3",
        "paddy_intake": "#fbbf24",
        "drying": "#fcd34d",
        "shipping_dock": "#3b82f6",
        "office": "#a78bfa",
        "wall": "#475569",
        "door": "#facc15",
        "walkway": "#cbd5e1",
        "loading_dock": "#f59e0b",
    }.get(zone_type, "#94a3b8")


def default_name_for(zone_type: str) -> str:
    return zone_type.replace("_", " ").title()
