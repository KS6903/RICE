"""Spatial warehouse canvas — Phase 1 read endpoint.

Returns layout + zones + pallets + batches for a branch. If no layout exists yet,
auto-bootstraps a sensible default layout and generates virtual pallets from the
branch's existing milled_rice_inventory so day-one is not empty.
"""
import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..core.database import get_db, SessionLocal
from ..core.security import get_current_user, require_feature, require_roles, decode_token, get_user_features
from ..models.company import Branch
from ..models.user import User
from ..models.warehouse import (
    WarehouseLayout, WarehouseZone, Pallet, RiceBatch, PalletMovement,
)
from ..models.milling import MilledRiceInventory
from ..models.reference import RiceVariety
from ..services.rice_shelf_life import (
    compute_best_before, aging_status, days_until_expiry,
)
from ..services.canvas_realtime import manager as ws_manager

# Roles allowed to mutate spatial state (move/stack/unstack)
WRITE_ROLES = ("owner", "admin", "mill_operator")

router = APIRouter(dependencies=[
    Depends(require_feature("inventory")),
    Depends(require_feature("canvas_inventory")),
])


# ── Default layout template ──────────────────────────────────────────────────
# Standard rice-mill warehouse footprints, sized to actual industry capacity.
# Defaults to "commercial" so new tenants get the biggest canvas to scale into.
DEFAULT_LAYOUT_WIDTH_M = 30.0
DEFAULT_LAYOUT_HEIGHT_M = 120.0

WAREHOUSE_SIZE_PRESETS: dict[str, dict] = {
    # capacity_label is shown to users alongside the dimensions
    "small":      {"width_m": 15.0, "height_m":  35.0, "capacity_label": "1–2 t/h"},
    "medium":     {"width_m": 18.0, "height_m":  60.0, "capacity_label": "3–5 t/h"},
    "large":      {"width_m": 24.0, "height_m":  80.0, "capacity_label": "6–10 t/h"},
    "commercial": {"width_m": 30.0, "height_m": 120.0, "capacity_label": ">10 t/h"},
}


def _compute_default_zones(width_m: float, height_m: float) -> list[tuple]:
    """Generate a proportional default-zone layout that scales to any warehouse
    footprint. Zones flow front-to-back along the long axis:
    receive → dry → mill → premium+customer storage (side-by-side) → general → ship.

    Returns a list of (zone_type, name, x_m, y_m, w_m, h_m, color_hex) tuples.
    Coords are clamped to fit inside `width_m × height_m` with a 1 m margin.
    """
    pad = 1.0
    w = max(width_m - 2 * pad, 1.0)   # usable width
    h = max(height_m - 2 * pad, 1.0)  # usable depth

    # Front-to-back band proportions of the usable depth
    BAND = [
        ("paddy_intake",  "Paddy Intake",   0.10, "#fbbf24"),
        ("drying",        "Drying Area",    0.08, "#f59e0b"),
        ("milling",       "Milling Floor",  0.18, "#94a3b8"),
        ("storage_split", None,             0.30, None),
        ("general",       "General Storage", 0.25, "#a78bfa"),
        ("shipping_dock", "Shipping Dock",  0.09, "#ec4899"),
    ]
    out: list[tuple] = []
    y = pad
    for ztype, name, frac, color in BAND:
        band_h = round(h * frac, 2)
        if ztype == "storage_split":
            half = round(w / 2 - 0.5, 2)
            out.append(("premium_storage",  "Premium Storage",   pad,             y, half, band_h, "#10b981"))
            out.append(("customer_storage", "Customer Holding",  pad + half + 1,  y, half, band_h, "#3b82f6"))
        else:
            out.append((ztype, name, pad, y, w, band_h, color))
        y = round(y + band_h, 2)
    return out


# Kept for backward-compat — any older callsite that reads this static list now
# gets a freshly-computed default-size zone set instead of stale 30×20 coords.
DEFAULT_ZONES = _compute_default_zones(DEFAULT_LAYOUT_WIDTH_M, DEFAULT_LAYOUT_HEIGHT_M)

# Structural elements: visual-only, cannot hold pallets. Drag-validation rejects
# moves that land on these. Anything not listed here is treated as storage.
STRUCTURAL_ZONE_TYPES = {"wall", "door", "walkway", "loading_dock"}

# All allowed zone_type values. Frontend uses this to populate dropdowns.
ALLOWED_ZONE_TYPES = [
    # storage
    "general", "milling", "premium_storage", "customer_storage",
    "paddy_intake", "drying", "shipping_dock", "office",
    # structural
    "wall", "door", "walkway", "loading_dock",
]


def _is_storage_zone(zone_type: str) -> bool:
    return zone_type not in STRUCTURAL_ZONE_TYPES

# Standard pallet: 25 sacks × 50kg = 1,250kg
SACKS_PER_PALLET = 25
KG_PER_SACK = 50
KG_PER_PALLET = SACKS_PER_PALLET * KG_PER_SACK


def _serialize_zone(z: WarehouseZone) -> dict:
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
        "is_storage": _is_storage_zone(z.zone_type),
    }


def _serialize_batch(b: RiceBatch, today: date) -> dict:
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


def _serialize_pallet(p: Pallet, today: date) -> dict:
    # Worst (most aged) status across all batches drives the pallet color
    statuses = [b.status for b in p.batches]
    rank = {"expired": 3, "critical": 2, "warning": 1, "fresh": 0}
    worst = max(statuses, key=lambda s: rank.get(s, 0)) if statuses else "fresh"
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
        "batches": [_serialize_batch(b, today) for b in p.batches],
    }


def _next_pallet_code(db: Session, company_id: uuid.UUID) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"PL-{year}-"
    last = (
        db.query(Pallet)
        .filter(Pallet.company_id == company_id, Pallet.pallet_code.like(f"{prefix}%"))
        .order_by(Pallet.pallet_code.desc())
        .first()
    )
    next_num = 1
    if last:
        try:
            next_num = int(last.pallet_code.rsplit("-", 1)[1]) + 1
        except (ValueError, IndexError):
            next_num = 1
    return f"{prefix}{next_num:04d}"


def _bootstrap_layout(db: Session, branch: Branch, name: str | None = None, is_default: bool = True) -> WarehouseLayout:
    """Create a layout + default zones for a branch."""
    layout = WarehouseLayout(
        branch_id=branch.id,
        company_id=branch.company_id,
        name=name or f"{branch.name} Warehouse",
        is_default=is_default,
        width_m=Decimal(str(DEFAULT_LAYOUT_WIDTH_M)),
        height_m=Decimal(str(DEFAULT_LAYOUT_HEIGHT_M)),
        grid_size_m=Decimal("0.5"),
    )
    db.add(layout)
    db.flush()
    for ztype, name, x, y, w, h, color in DEFAULT_ZONES:
        db.add(WarehouseZone(
            layout_id=layout.id,
            zone_type=ztype,
            name=name,
            x_m=Decimal(str(x)), y_m=Decimal(str(y)),
            width_m=Decimal(str(w)), height_m=Decimal(str(h)),
            color_hex=color,
        ))
    db.flush()
    return layout


def _bootstrap_pallets_from_inventory(db: Session, layout: WarehouseLayout) -> int:
    """Generate virtual pallets from the branch's milled_rice_inventory rows.

    One pallet per ~1,250kg chunk per (variety, grade) row, auto-placed in the
    Premium Storage zone in a tidy grid.
    """
    premium_zone = (
        db.query(WarehouseZone)
        .filter(WarehouseZone.layout_id == layout.id, WarehouseZone.zone_type == "premium_storage")
        .first()
    )
    if not premium_zone:
        return 0

    inv_rows = (
        db.query(MilledRiceInventory)
        .filter(
            MilledRiceInventory.company_id == layout.company_id,
            MilledRiceInventory.branch_id == layout.branch_id,
            MilledRiceInventory.quantity_kg > 0,
        )
        .options(joinedload(MilledRiceInventory.variety))
        .all()
    )

    # Position grid inside the Premium Storage zone
    pallet_w_m, pallet_d_m = 1.2, 0.8
    spacing = 0.3  # 30cm aisle between pallets
    cols = max(1, int((float(premium_zone.width_m) - 0.5) // (pallet_w_m + spacing)))
    created = 0
    today = date.today()

    slot = 0
    for inv in inv_rows:
        remaining = float(inv.quantity_kg)
        while remaining > 0.01:
            chunk_kg = min(KG_PER_PALLET, remaining)
            sacks = max(1, int(round(chunk_kg / KG_PER_SACK)))
            actual_kg = sacks * KG_PER_SACK
            remaining -= actual_kg

            col = slot % cols
            row = slot // cols
            px = float(premium_zone.x_m) + 0.25 + col * (pallet_w_m + spacing)
            py = float(premium_zone.y_m) + 0.5 + row * (pallet_d_m + spacing)

            # Stop if we overflow the zone vertically
            if py + pallet_d_m > float(premium_zone.y_m) + float(premium_zone.height_m) - 0.25:
                break

            pallet = Pallet(
                company_id=layout.company_id,
                layout_id=layout.id,
                zone_id=premium_zone.id,
                pallet_code=_next_pallet_code(db, layout.company_id),
                x_m=Decimal(str(round(px, 2))),
                y_m=Decimal(str(round(py, 2))),
                z_layer=0,
                width_m=Decimal(str(pallet_w_m)),
                depth_m=Decimal(str(pallet_d_m)),
                sack_count=sacks,
                weight_kg=Decimal(str(actual_kg)),
                status="in_storage",
            )
            db.add(pallet)
            db.flush()

            # Synthesize batch — milling date unknown for legacy stock, assume 30 days ago
            assumed_milling = today.replace(day=max(1, today.day - 1))
            from datetime import timedelta
            assumed_milling = today - timedelta(days=30)
            moisture = Decimal("13.5")  # safe assumption for milled bigas
            best_before = compute_best_before(assumed_milling, moisture)
            status_now = aging_status(assumed_milling, moisture, today)

            db.add(RiceBatch(
                company_id=layout.company_id,
                pallet_id=pallet.id,
                variety_id=inv.variety_id,
                client_type="mill_own",
                client_name="Mill stock (auto-imported)",
                sack_count=sacks,
                weight_kg=Decimal(str(actual_kg)),
                moisture_pct=moisture,
                milling_date=assumed_milling,
                best_before_date=best_before,
                status=status_now,
                notes=f"Auto-generated from {inv.grade_name or 'inventory'} on {today.isoformat()}",
            ))
            slot += 1
            created += 1
        if remaining > 0.01:
            # We ran out of zone space; rest stays as untracked inventory
            break

    db.flush()
    return created


def _get_default_layout(db: Session, branch_id: uuid.UUID) -> WarehouseLayout | None:
    """Return the is_default=True layout for a branch, falling back to any layout."""
    layouts = db.query(WarehouseLayout).filter(WarehouseLayout.branch_id == branch_id).all()
    if not layouts:
        return None
    return next((l for l in layouts if l.is_default), layouts[0])


def _get_or_bootstrap(db: Session, branch: Branch) -> WarehouseLayout:
    layout = _get_default_layout(db, branch.id)
    if not layout:
        layout = _bootstrap_layout(db, branch, is_default=True)
        _bootstrap_pallets_from_inventory(db, layout)
        db.commit()
        db.refresh(layout)
    return layout


@router.get("/warehouses/{branch_id}/canvas")
def get_warehouse_canvas(
    branch_id: uuid.UUID,
    layout_id: uuid.UUID | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns the full canvas payload for one branch's warehouse.

    Pass ?layout_id=<uuid> to fetch a specific layout; omit it for the default.
    """
    branch = db.get(Branch, branch_id)
    if not branch or branch.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Branch not found")

    if layout_id:
        layout = db.query(WarehouseLayout).filter(
            WarehouseLayout.id == layout_id,
            WarehouseLayout.branch_id == branch_id,
        ).first()
        if not layout:
            raise HTTPException(status_code=404, detail="Layout not found")
    else:
        layout = _get_or_bootstrap(db, branch)
    today = date.today()

    # Refresh status on every read so colors stay current as time passes
    for batch in db.query(RiceBatch).filter(RiceBatch.company_id == branch.company_id).all():
        new_status = aging_status(batch.milling_date, batch.moisture_pct, today)
        if batch.status != new_status:
            batch.status = new_status
    db.commit()

    zones = db.query(WarehouseZone).filter(WarehouseZone.layout_id == layout.id).all()
    pallets = (
        db.query(Pallet)
        .filter(Pallet.layout_id == layout.id)
        .options(joinedload(Pallet.batches).joinedload(RiceBatch.variety),
                 joinedload(Pallet.batches).joinedload(RiceBatch.grade))
        .all()
    )

    return {
        "layout": {
            "id": str(layout.id),
            "name": layout.name,
            "branch_id": str(layout.branch_id),
            "branch_name": branch.name,
            "width_m": float(layout.width_m),
            "height_m": float(layout.height_m),
            "grid_size_m": float(layout.grid_size_m),
            "version": layout.version,
        },
        "zones": [_serialize_zone(z) for z in zones],
        "pallets": [_serialize_pallet(p, today) for p in pallets],
        "summary": {
            "total_pallets": len(pallets),
            "total_weight_kg": sum(float(p.weight_kg) for p in pallets),
            "by_aging": {
                "fresh":    sum(1 for p in pallets if any(b.status == "fresh"    for b in p.batches)),
                "warning":  sum(1 for p in pallets if any(b.status == "warning"  for b in p.batches)),
                "critical": sum(1 for p in pallets if any(b.status == "critical" for b in p.batches)),
                "expired":  sum(1 for p in pallets if any(b.status == "expired"  for b in p.batches)),
            },
        },
    }


# ── Phase 2: drag-to-move, stacking, audit trail ─────────────────────────────


def _serialize_movement(m: PalletMovement) -> dict:
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


def _zone_containing(layout: WarehouseLayout, x_m: float, y_m: float, db: Session, storage_only: bool = True) -> WarehouseZone | None:
    """Find the zone whose bounding rectangle contains the point (x_m, y_m).

    By default ignores structural zones (walls, doors, walkways). Pass
    storage_only=False to consider every zone — used to detect dropping a
    pallet onto a wall so we can reject it.
    """
    zones = db.query(WarehouseZone).filter(WarehouseZone.layout_id == layout.id).all()
    # Iterate front-to-back: smaller zones drawn on top should win on overlap.
    # Sort by area ascending so the smallest match wins (typically what the eye picks).
    zones.sort(key=lambda z: float(z.width_m) * float(z.height_m))
    for z in zones:
        if storage_only and not _is_storage_zone(z.zone_type):
            continue
        zx, zy = float(z.x_m), float(z.y_m)
        zw, zh = float(z.width_m), float(z.height_m)
        if zx <= x_m <= zx + zw and zy <= y_m <= zy + zh:
            return z
    return None


def _structural_overlap(
    layout: WarehouseLayout, x_m: float, y_m: float, w_m: float, d_m: float, db: Session,
) -> WarehouseZone | None:
    """Return the first structural zone (wall/door/walkway/dock) whose
    rectangle overlaps the given pallet footprint. Used by the move-validator
    so even a partial collision with a wall is rejected."""
    zones = db.query(WarehouseZone).filter(WarehouseZone.layout_id == layout.id).all()
    for z in zones:
        if _is_storage_zone(z.zone_type):
            continue
        zx, zy = float(z.x_m), float(z.y_m)
        zw, zh = float(z.width_m), float(z.height_m)
        # AABB intersection test
        if x_m < zx + zw and x_m + w_m > zx and y_m < zy + zh and y_m + d_m > zy:
            return z
    return None


def _ensure_owned_pallet(db: Session, pallet_id: uuid.UUID, user) -> Pallet:
    p = db.get(Pallet, pallet_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pallet not found")
    if p.company_id != user.company_id:
        raise HTTPException(status_code=403, detail="Pallet belongs to another company")
    return p


class PalletMove(BaseModel):
    x_m: float
    y_m: float


@router.patch("/pallets/{pallet_id}/move")
def move_pallet(
    pallet_id: uuid.UUID,
    body: PalletMove,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Reposition a pallet to (x_m, y_m). Auto-assigns the zone the point falls into.

    Refuses to move pallets that are stacked under another (must unstack first).
    """
    pallet = _ensure_owned_pallet(db, pallet_id, current_user)
    layout = db.get(WarehouseLayout, pallet.layout_id)
    if not layout:
        raise HTTPException(status_code=500, detail="Layout missing for pallet")

    # Don't allow moving a pallet that has others stacked on top
    stacked_above = db.query(Pallet).filter(Pallet.stack_parent_id == pallet.id).first()
    if stacked_above:
        raise HTTPException(status_code=409, detail="Cannot move: another pallet is stacked on this one. Unstack it first.")

    # Clamp to layout bounds with a small margin
    margin = 0.1
    lw, lh = float(layout.width_m), float(layout.height_m)
    new_x = max(margin, min(lw - float(pallet.width_m) - margin, body.x_m))
    new_y = max(margin, min(lh - float(pallet.depth_m) - margin, body.y_m))

    # Reject if any part of the pallet footprint overlaps a structural element.
    pw, pd = float(pallet.width_m), float(pallet.depth_m)
    structural_hit = _structural_overlap(layout, new_x, new_y, pw, pd, db)
    if structural_hit:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot drop a pallet on a {structural_hit.zone_type.replace('_', ' ')} ('{structural_hit.name}'). Move it to a storage area instead.",
        )

    from_x, from_y = float(pallet.x_m), float(pallet.y_m)
    from_zone_id = pallet.zone_id

    new_zone = _zone_containing(layout, new_x, new_y, db)
    pallet.x_m = Decimal(str(round(new_x, 2)))
    pallet.y_m = Decimal(str(round(new_y, 2)))
    pallet.zone_id = new_zone.id if new_zone else None
    # If this pallet was stacked, dropping it elsewhere implicitly unstacks
    if pallet.stack_parent_id:
        pallet.stack_parent_id = None
        pallet.z_layer = 0

    db.add(PalletMovement(
        pallet_id=pallet.id,
        user_id=current_user.id,
        movement_type="move",
        from_x_m=Decimal(str(round(from_x, 2))),
        from_y_m=Decimal(str(round(from_y, 2))),
        to_x_m=pallet.x_m,
        to_y_m=pallet.y_m,
        from_zone_id=from_zone_id,
        to_zone_id=pallet.zone_id,
    ))
    db.commit()
    db.refresh(pallet)
    payload = _serialize_pallet(pallet, date.today())
    ws_manager.broadcast_sync(pallet.layout_id, "pallet.moved", {"pallet": payload, "by_user_id": str(current_user.id)})
    return payload


class PalletResize(BaseModel):
    width_m: float
    depth_m: float


@router.patch("/pallets/{pallet_id}/resize")
def resize_pallet(
    pallet_id: uuid.UUID,
    body: PalletResize,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Resize a pallet's footprint. Clamps to layout bounds and refuses overlaps
    with structural elements at the new size."""
    pallet = _ensure_owned_pallet(db, pallet_id, current_user)
    layout = db.get(WarehouseLayout, pallet.layout_id)
    if not layout:
        raise HTTPException(status_code=500, detail="Layout missing for pallet")

    # Sensible footprint limits — small enough to fit any zone, big enough to read
    if body.width_m < 0.4 or body.width_m > 6.0:
        raise HTTPException(status_code=400, detail="width_m must be between 0.4 and 6.0")
    if body.depth_m < 0.4 or body.depth_m > 6.0:
        raise HTTPException(status_code=400, detail="depth_m must be between 0.4 and 6.0")

    margin = 0.05
    lw, lh = float(layout.width_m), float(layout.height_m)
    new_w = round(min(body.width_m, max(0.4, lw - float(pallet.x_m) - margin)), 2)
    new_d = round(min(body.depth_m, max(0.4, lh - float(pallet.y_m) - margin)), 2)

    structural_hit = _structural_overlap(layout, float(pallet.x_m), float(pallet.y_m), new_w, new_d, db)
    if structural_hit:
        raise HTTPException(
            status_code=409,
            detail=f"New size would overlap a {structural_hit.zone_type.replace('_', ' ')} ('{structural_hit.name}').",
        )

    pallet.width_m = Decimal(str(new_w))
    pallet.depth_m = Decimal(str(new_d))
    db.commit()
    db.refresh(pallet)
    payload = _serialize_pallet(pallet, date.today())
    ws_manager.broadcast_sync(pallet.layout_id, "pallet.moved", {"pallet": payload, "by_user_id": str(current_user.id)})
    return payload


class PalletStack(BaseModel):
    parent_pallet_id: uuid.UUID


@router.patch("/pallets/{pallet_id}/stack")
def stack_pallet(
    pallet_id: uuid.UUID,
    body: PalletStack,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Stack `pallet_id` on top of `parent_pallet_id`."""
    if pallet_id == body.parent_pallet_id:
        raise HTTPException(status_code=400, detail="A pallet cannot stack on itself.")

    pallet = _ensure_owned_pallet(db, pallet_id, current_user)
    parent = _ensure_owned_pallet(db, body.parent_pallet_id, current_user)

    if pallet.layout_id != parent.layout_id:
        raise HTTPException(status_code=400, detail="Pallets are in different warehouses.")

    # Don't allow stacking if this pallet has children already (would need to bring its stack along)
    has_children = db.query(Pallet).filter(Pallet.stack_parent_id == pallet.id).first()
    if has_children:
        raise HTTPException(status_code=409, detail="Cannot stack: this pallet already has others on top of it.")

    # Don't allow more than 4 layers high (typical warehouse safety limit for rice sacks)
    if parent.z_layer >= 3:
        raise HTTPException(status_code=409, detail="Stack height limit reached (max 4 layers).")

    from_x, from_y = float(pallet.x_m), float(pallet.y_m)
    from_zone_id = pallet.zone_id

    pallet.stack_parent_id = parent.id
    pallet.z_layer = parent.z_layer + 1
    pallet.x_m = parent.x_m
    pallet.y_m = parent.y_m
    pallet.zone_id = parent.zone_id

    db.add(PalletMovement(
        pallet_id=pallet.id,
        user_id=current_user.id,
        movement_type="stack",
        from_x_m=Decimal(str(round(from_x, 2))),
        from_y_m=Decimal(str(round(from_y, 2))),
        to_x_m=pallet.x_m,
        to_y_m=pallet.y_m,
        from_zone_id=from_zone_id,
        to_zone_id=pallet.zone_id,
        notes=f"Stacked on {parent.pallet_code}",
    ))
    db.commit()
    db.refresh(pallet)
    payload = _serialize_pallet(pallet, date.today())
    ws_manager.broadcast_sync(pallet.layout_id, "pallet.stacked", {"pallet": payload, "parent_id": str(parent.id), "by_user_id": str(current_user.id)})
    return payload


class PalletUnstack(BaseModel):
    x_m: float | None = None
    y_m: float | None = None


@router.patch("/pallets/{pallet_id}/unstack")
def unstack_pallet(
    pallet_id: uuid.UUID,
    body: PalletUnstack,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Pop a pallet off its stack. If x_m/y_m given, place it there; otherwise drop beside parent."""
    pallet = _ensure_owned_pallet(db, pallet_id, current_user)
    if not pallet.stack_parent_id:
        raise HTTPException(status_code=400, detail="Pallet is not stacked.")

    layout = db.get(WarehouseLayout, pallet.layout_id)
    if not layout:
        raise HTTPException(status_code=500, detail="Layout missing for pallet")

    from_x, from_y = float(pallet.x_m), float(pallet.y_m)
    if body.x_m is not None and body.y_m is not None:
        new_x, new_y = body.x_m, body.y_m
    else:
        # Drop 1.5m to the right of the parent
        new_x = from_x + 1.5
        new_y = from_y

    # Clamp
    lw, lh = float(layout.width_m), float(layout.height_m)
    new_x = max(0.1, min(lw - float(pallet.width_m) - 0.1, new_x))
    new_y = max(0.1, min(lh - float(pallet.depth_m) - 0.1, new_y))

    new_zone = _zone_containing(layout, new_x, new_y, db)
    pallet.x_m = Decimal(str(round(new_x, 2)))
    pallet.y_m = Decimal(str(round(new_y, 2)))
    pallet.zone_id = new_zone.id if new_zone else None
    pallet.stack_parent_id = None
    pallet.z_layer = 0

    db.add(PalletMovement(
        pallet_id=pallet.id,
        user_id=current_user.id,
        movement_type="unstack",
        from_x_m=Decimal(str(round(from_x, 2))),
        from_y_m=Decimal(str(round(from_y, 2))),
        to_x_m=pallet.x_m,
        to_y_m=pallet.y_m,
        to_zone_id=pallet.zone_id,
    ))
    db.commit()
    db.refresh(pallet)
    payload = _serialize_pallet(pallet, date.today())
    ws_manager.broadcast_sync(pallet.layout_id, "pallet.unstacked", {"pallet": payload, "by_user_id": str(current_user.id)})
    return payload


@router.get("/pallets/{pallet_id}/movements")
def list_movements(
    pallet_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pallet = _ensure_owned_pallet(db, pallet_id, current_user)
    rows = (
        db.query(PalletMovement)
        .filter(PalletMovement.pallet_id == pallet.id)
        .order_by(PalletMovement.created_at.desc())
        .limit(50)
        .all()
    )
    return [_serialize_movement(m) for m in rows]


# ── Phase 3: realtime sync + FIFO dispatch ───────────────────────────────────


# Dedicated router for the WebSocket so we can omit the require_feature
# dependency (it forces HTTP-style auth via OAuth2PasswordBearer).
ws_router = APIRouter()


def _authenticate_ws(token: str | None, db: Session) -> User | None:
    """Decode a JWT from the WS query string and return the user, or None."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        user = db.get(User, user_id)
        if not user or not user.is_active:
            return None
        return user
    except HTTPException:
        return None
    except Exception:
        return None


@ws_router.websocket("/ws/canvas/{layout_id}")
async def canvas_ws(websocket: WebSocket, layout_id: uuid.UUID, token: str | None = None):
    """Live updates for one warehouse layout.

    Auth: ?token=<access JWT>. Subscribers must belong to the same company as
    the layout — otherwise we close immediately with policy violation.
    """
    db = SessionLocal()
    try:
        user = _authenticate_ws(token, db)
        if not user:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return

        # Plan gate: only Pro+ tenants get realtime canvas
        features = get_user_features(user, db)
        if "*" not in features and "canvas_inventory" not in features:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Plan does not include canvas_inventory")
            return

        layout = db.get(WarehouseLayout, layout_id)
        if not layout or layout.company_id != user.company_id:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Layout not found")
            return

        await ws_manager.connect(layout_id, websocket)
        await websocket.send_text(
            '{"event":"hello","payload":{"layout_id":"' + str(layout_id) + '","ok":true}}'
        )

        try:
            # Keep the connection alive. We don't expect client→server messages
            # in this phase — the client uses HTTP for writes. Just read & drop
            # pings.
            while True:
                msg = await websocket.receive_text()
                if msg == "ping":
                    await websocket.send_text('{"event":"pong","payload":{}}')
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
    finally:
        await ws_manager.disconnect(layout_id, websocket)
        db.close()


# ── FIFO dispatch recommender ────────────────────────────────────────────────


class DispatchRecommendRequest(BaseModel):
    variety_id: uuid.UUID | None = None
    variety_code: str | None = None  # convenience: lets callers use "Rc222"
    weight_kg: float                  # how many kg needed
    branch_id: uuid.UUID | None = None  # restrict to one branch's layout


def _resolve_variety_id(db: Session, company_id: uuid.UUID, req: DispatchRecommendRequest) -> uuid.UUID | None:
    if req.variety_id:
        return req.variety_id
    if req.variety_code:
        v = (
            db.query(RiceVariety)
            .filter(RiceVariety.code == req.variety_code)
            .first()
        )
        if v:
            return v.id
    return None


@router.post("/dispatch/recommend")
def recommend_fifo(
    body: DispatchRecommendRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the ordered list of pallets to pull (oldest milling_date first)
    that together cover `weight_kg`. Used to highlight pallets on the canvas
    when fulfilling a sales order.

    Behavior:
      - Filters by variety if provided.
      - Filters to a single layout if branch_id provided (otherwise all the
        company's layouts).
      - Skips pallets that are stacked under something else (have children).
      - Returns the chosen pallets + a summary block.
    """
    variety_id = _resolve_variety_id(db, current_user.company_id, body)

    layout_filter = []
    if body.branch_id:
        layout = (
            db.query(WarehouseLayout)
            .filter(
                WarehouseLayout.branch_id == body.branch_id,
                WarehouseLayout.company_id == current_user.company_id,
            )
            .first()
        )
        if layout:
            layout_filter = [Pallet.layout_id == layout.id]

    # Pallets with their oldest batch's milling_date, joined.
    q = (
        db.query(Pallet, RiceBatch)
        .join(RiceBatch, RiceBatch.pallet_id == Pallet.id)
        .filter(
            Pallet.company_id == current_user.company_id,
            Pallet.status == "in_storage",
            *layout_filter,
        )
    )
    if variety_id:
        q = q.filter(RiceBatch.variety_id == variety_id)

    rows = q.order_by(RiceBatch.milling_date.asc(), Pallet.created_at.asc()).all()

    # Dedupe by pallet (keep oldest batch's date as "age")
    by_pallet: dict[uuid.UUID, tuple[Pallet, RiceBatch]] = {}
    for p, b in rows:
        if p.id not in by_pallet or b.milling_date < by_pallet[p.id][1].milling_date:
            by_pallet[p.id] = (p, b)

    # Filter out pallets that have something stacked on top — can't extract
    children_set = {c.stack_parent_id for c in db.query(Pallet).filter(Pallet.stack_parent_id.isnot(None)).all()}

    candidates = sorted(by_pallet.values(), key=lambda pb: pb[1].milling_date)
    chosen: list[tuple[Pallet, RiceBatch]] = []
    total = 0.0
    for p, b in candidates:
        if p.id in children_set:
            continue
        chosen.append((p, b))
        total += float(p.weight_kg)
        if total >= body.weight_kg:
            break

    today = date.today()
    return {
        "requested_kg": body.weight_kg,
        "total_kg": total,
        "shortfall_kg": max(0.0, body.weight_kg - total),
        "variety_id": str(variety_id) if variety_id else None,
        "pallet_ids": [str(p.id) for p, _ in chosen],
        "pallets": [
            {
                "id": str(p.id),
                "pallet_code": p.pallet_code,
                "layout_id": str(p.layout_id),
                "zone_id": str(p.zone_id) if p.zone_id else None,
                "x_m": float(p.x_m),
                "y_m": float(p.y_m),
                "weight_kg": float(p.weight_kg),
                "sack_count": p.sack_count,
                "variety_code": b.variety.code if b.variety else None,
                "milling_date": b.milling_date.isoformat(),
                "days_old": (today - b.milling_date).days,
                "aging_status": b.status,
            }
            for p, b in chosen
        ],
    }


@router.get("/warehouses/{branch_id}/aging-report")
def aging_report(
    branch_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-zone + per-aging-state pallet counts for one branch's warehouse.

    Returns the data behind the heatmap and the aging-report panel. Includes
    the 5 oldest pallets currently in stock for quick FIFO triage.
    """
    branch = db.get(Branch, branch_id)
    if not branch or branch.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Branch not found")
    layout = db.query(WarehouseLayout).filter(WarehouseLayout.branch_id == branch_id).first()
    if not layout:
        raise HTTPException(status_code=404, detail="No warehouse layout for this branch")

    zones = db.query(WarehouseZone).filter(WarehouseZone.layout_id == layout.id).all()
    pallets = (
        db.query(Pallet)
        .filter(Pallet.layout_id == layout.id)
        .options(joinedload(Pallet.batches).joinedload(RiceBatch.variety))
        .all()
    )

    today = date.today()
    # Per-zone aggregation
    per_zone: dict[str | None, dict] = {}
    for z in zones:
        per_zone[str(z.id)] = {
            "zone_id": str(z.id),
            "zone_name": z.name,
            "zone_type": z.zone_type,
            "color_hex": z.color_hex,
            "max_weight_kg": float(z.max_weight_kg) if z.max_weight_kg else None,
            "pallet_count": 0,
            "weight_kg": 0.0,
            "utilization_pct": None,
            "by_aging": {"fresh": 0, "warning": 0, "critical": 0, "expired": 0},
        }
    per_zone[None] = {
        "zone_id": None,
        "zone_name": "Unassigned",
        "zone_type": "unassigned",
        "color_hex": "#94a3b8",
        "max_weight_kg": None,
        "pallet_count": 0,
        "weight_kg": 0.0,
        "utilization_pct": None,
        "by_aging": {"fresh": 0, "warning": 0, "critical": 0, "expired": 0},
    }

    oldest: list[dict] = []
    totals = {"fresh": 0, "warning": 0, "critical": 0, "expired": 0}

    for p in pallets:
        rank = {"expired": 3, "critical": 2, "warning": 1, "fresh": 0}
        statuses = [b.status for b in p.batches]
        worst = max(statuses, key=lambda s: rank.get(s, 0)) if statuses else "fresh"
        bucket = per_zone.get(str(p.zone_id) if p.zone_id else None, per_zone[None])
        bucket["pallet_count"] += 1
        bucket["weight_kg"] += float(p.weight_kg)
        bucket["by_aging"][worst] += 1
        totals[worst] += 1

        for b in p.batches:
            oldest.append({
                "pallet_id": str(p.id),
                "pallet_code": p.pallet_code,
                "variety_code": b.variety.code if b.variety else None,
                "milling_date": b.milling_date.isoformat(),
                "days_old": (today - b.milling_date).days,
                "best_before_date": b.best_before_date.isoformat() if b.best_before_date else None,
                "weight_kg": float(b.weight_kg),
                "status": b.status,
            })

    for bucket in per_zone.values():
        if bucket["max_weight_kg"]:
            bucket["utilization_pct"] = round(
                100.0 * bucket["weight_kg"] / bucket["max_weight_kg"], 1
            )

    oldest.sort(key=lambda b: b["milling_date"])
    return {
        "branch_id": str(branch_id),
        "branch_name": branch.name,
        "as_of": today.isoformat(),
        "totals": totals,
        "total_pallets": len(pallets),
        "total_weight_kg": sum(float(p.weight_kg) for p in pallets),
        "zones": [v for k, v in per_zone.items() if k is not None or v["pallet_count"] > 0],
        "oldest_5": oldest[:5],
        "expired_pallets": [b for b in oldest if b["status"] == "expired"][:20],
    }


# ── Phase 5: warehouse builder (layout + zone CRUD) ──────────────────────────


@router.get("/canvas/zone-types")
def list_zone_types(_user=Depends(get_current_user)):
    """Returns the allowed zone-type taxonomy. Frontend uses this to populate
    the zone-editor dropdown and the builder toolbox."""
    return {
        "storage": [t for t in ALLOWED_ZONE_TYPES if t not in STRUCTURAL_ZONE_TYPES],
        "structural": [t for t in ALLOWED_ZONE_TYPES if t in STRUCTURAL_ZONE_TYPES],
    }


class LayoutPatch(BaseModel):
    name: str | None = None
    width_m: float | None = None
    height_m: float | None = None
    grid_size_m: float | None = None


@router.patch("/warehouses/{branch_id}/layout")
def patch_layout(
    branch_id: uuid.UUID,
    body: LayoutPatch,
    layout_id: uuid.UUID | None = None,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Resize / rename the warehouse layout itself.

    Pass ?layout_id=<uuid> to target a specific layout; omit for the branch default.
    """
    branch = db.get(Branch, branch_id)
    if not branch or branch.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Branch not found")
    if layout_id:
        layout = db.query(WarehouseLayout).filter(
            WarehouseLayout.id == layout_id,
            WarehouseLayout.branch_id == branch_id,
        ).first()
    else:
        layout = _get_default_layout(db, branch_id)
    if not layout:
        raise HTTPException(status_code=404, detail="No warehouse layout for this branch")

    if body.name is not None:
        layout.name = body.name.strip() or layout.name
    if body.width_m is not None:
        if body.width_m < 5 or body.width_m > 200:
            raise HTTPException(status_code=400, detail="width_m must be between 5 and 200")
        layout.width_m = Decimal(str(round(body.width_m, 2)))
    if body.height_m is not None:
        if body.height_m < 5 or body.height_m > 200:
            raise HTTPException(status_code=400, detail="height_m must be between 5 and 200")
        layout.height_m = Decimal(str(round(body.height_m, 2)))
    if body.grid_size_m is not None:
        if body.grid_size_m < 0.1 or body.grid_size_m > 2.0:
            raise HTTPException(status_code=400, detail="grid_size_m must be between 0.1 and 2.0")
        layout.grid_size_m = Decimal(str(round(body.grid_size_m, 2)))

    layout.version += 1
    db.commit()
    db.refresh(layout)

    payload = {
        "id": str(layout.id),
        "name": layout.name,
        "branch_id": str(layout.branch_id),
        "branch_name": branch.name,
        "width_m": float(layout.width_m),
        "height_m": float(layout.height_m),
        "grid_size_m": float(layout.grid_size_m),
        "version": layout.version,
    }
    ws_manager.broadcast_sync(layout.id, "layout.updated", {"layout": payload, "by_user_id": str(current_user.id)})
    return payload


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


@router.post("/warehouses/{branch_id}/zones", status_code=201)
def create_zone(
    branch_id: uuid.UUID,
    body: ZoneCreate,
    layout_id: uuid.UUID | None = None,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Draw a new zone on the floor. Pass ?layout_id=<uuid> to target a specific layout."""
    if body.zone_type not in ALLOWED_ZONE_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown zone_type '{body.zone_type}'")
    branch = db.get(Branch, branch_id)
    if not branch or branch.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Branch not found")
    if layout_id:
        layout = db.query(WarehouseLayout).filter(
            WarehouseLayout.id == layout_id,
            WarehouseLayout.branch_id == branch_id,
        ).first()
    else:
        layout = _get_default_layout(db, branch_id)
    if not layout:
        raise HTTPException(status_code=404, detail="No warehouse layout for this branch")

    lw, lh = float(layout.width_m), float(layout.height_m)
    is_structural = not _is_storage_zone(body.zone_type)
    # Storage zones are clamped inside the floor; structural zones (door, wall,
    # walkway, loading_dock) may straddle or sit outside the boundary.
    w = max(0.5, body.width_m if is_structural else min(lw, body.width_m))
    h = max(0.5, body.height_m if is_structural else min(lh, body.height_m))
    x = body.x_m if is_structural else max(0.0, min(lw - w, body.x_m))
    y = body.y_m if is_structural else max(0.0, min(lh - h, body.y_m))

    color = body.color_hex or _default_color_for(body.zone_type)
    zone = WarehouseZone(
        layout_id=layout.id,
        zone_type=body.zone_type,
        name=body.name.strip() or _default_name_for(body.zone_type),
        x_m=Decimal(str(round(x, 2))),
        y_m=Decimal(str(round(y, 2))),
        width_m=Decimal(str(round(w, 2))),
        height_m=Decimal(str(round(h, 2))),
        color_hex=color,
        max_weight_kg=Decimal(str(body.max_weight_kg)) if body.max_weight_kg else None,
        notes=body.notes,
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)
    payload = _serialize_zone(zone)
    ws_manager.broadcast_sync(layout.id, "zone.created", {"zone": payload, "by_user_id": str(current_user.id)})
    return payload


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


@router.patch("/zones/{zone_id}")
def patch_zone(
    zone_id: uuid.UUID,
    body: ZonePatch,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Rename, resize, recolor, retype, or annotate an existing zone."""
    zone = db.get(WarehouseZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    layout = db.get(WarehouseLayout, zone.layout_id)
    if not layout or layout.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Zone belongs to another company")

    if body.zone_type is not None:
        if body.zone_type not in ALLOWED_ZONE_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown zone_type '{body.zone_type}'")
        # Converting from storage → structural with pallets inside? Eject them
        # to "Unassigned" so they don't sit on a wall.
        if _is_storage_zone(zone.zone_type) and not _is_storage_zone(body.zone_type):
            db.query(Pallet).filter(Pallet.zone_id == zone.id).update({Pallet.zone_id: None})
        zone.zone_type = body.zone_type
    if body.name is not None:
        zone.name = body.name.strip() or zone.name
    if body.color_hex is not None:
        zone.color_hex = body.color_hex
    if body.notes is not None:
        zone.notes = body.notes
    if body.max_weight_kg is not None:
        zone.max_weight_kg = Decimal(str(body.max_weight_kg)) if body.max_weight_kg else None

    lw, lh = float(layout.width_m), float(layout.height_m)
    new_w = body.width_m if body.width_m is not None else float(zone.width_m)
    new_h = body.height_m if body.height_m is not None else float(zone.height_m)
    new_x = body.x_m if body.x_m is not None else float(zone.x_m)
    new_y = body.y_m if body.y_m is not None else float(zone.y_m)
    # Structural zones (door, wall, walkway, loading_dock) may be placed anywhere;
    # only enforce a minimum size. Storage zones are clamped inside the floor.
    is_structural = not _is_storage_zone(zone.zone_type)
    new_w = max(0.5, new_w if is_structural else min(lw, new_w))
    new_h = max(0.5, new_h if is_structural else min(lh, new_h))
    new_x = new_x if is_structural else max(0.0, min(lw - new_w, new_x))
    new_y = new_y if is_structural else max(0.0, min(lh - new_h, new_y))
    zone.width_m = Decimal(str(round(new_w, 2)))
    zone.height_m = Decimal(str(round(new_h, 2)))
    zone.x_m = Decimal(str(round(new_x, 2)))
    zone.y_m = Decimal(str(round(new_y, 2)))

    db.commit()
    db.refresh(zone)
    payload = _serialize_zone(zone)
    ws_manager.broadcast_sync(layout.id, "zone.updated", {"zone": payload, "by_user_id": str(current_user.id)})
    return payload


@router.delete("/zones/{zone_id}")
def delete_zone(
    zone_id: uuid.UUID,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Delete a zone. Pallets inside it get zone_id=NULL (they keep their
    coordinates so the user can re-assign them visually)."""
    zone = db.get(WarehouseZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    layout = db.get(WarehouseLayout, zone.layout_id)
    if not layout or layout.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Zone belongs to another company")
    layout_id = layout.id
    zid = zone.id
    db.delete(zone)
    db.commit()
    ws_manager.broadcast_sync(layout_id, "zone.deleted", {"zone_id": str(zid), "by_user_id": str(current_user.id)})
    return {"message": "Zone deleted"}


def _default_color_for(zone_type: str) -> str:
    return {
        "milling":           "#94a3b8",
        "premium_storage":   "#10b981",
        "customer_storage":  "#0ea5e9",
        "general":           "#a3a3a3",
        "paddy_intake":      "#fbbf24",
        "drying":            "#fcd34d",
        "shipping_dock":     "#3b82f6",
        "office":            "#a78bfa",
        "wall":              "#475569",
        "door":              "#facc15",
        "walkway":           "#cbd5e1",
        "loading_dock":      "#f59e0b",
    }.get(zone_type, "#94a3b8")


def _default_name_for(zone_type: str) -> str:
    return zone_type.replace("_", " ").title()


# ── Customer-specific stock ──────────────────────────────────────────────────


@router.get("/canvas/customers")
def list_canvas_customers(
    branch_id: uuid.UUID | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Distinct clients (suppliers/customers/mill_own) with active pallets in
    the canvas, with their assigned canvas color and occupancy stats."""
    from ..models.supplier_customer import Customer, Supplier

    q = db.query(RiceBatch, Pallet).join(Pallet, Pallet.id == RiceBatch.pallet_id).filter(
        RiceBatch.company_id == current_user.company_id,
    )
    if branch_id:
        # Multi-layout: a branch can hold several layouts. Scope to pallets in
        # any of THIS branch's layouts (was previously only .first() which would
        # silently miss pallets if the test seed created extra empty layouts).
        layout_ids = [
            row.id for row in db.query(WarehouseLayout.id).filter(
                WarehouseLayout.branch_id == branch_id,
                WarehouseLayout.company_id == current_user.company_id,
            ).all()
        ]
        if layout_ids:
            q = q.filter(Pallet.layout_id.in_(layout_ids))

    rows = q.all()

    # Aggregate by (client_id, client_type, client_name)
    agg: dict[tuple, dict] = {}
    for batch, pallet in rows:
        key = (str(batch.client_id) if batch.client_id else None, batch.client_type, batch.client_name or "—")
        if key not in agg:
            agg[key] = {
                "client_id": key[0],
                "client_type": key[1],
                "client_name": key[2],
                "color_hex": None,
                "pallet_ids": set(),
                "weight_kg": 0.0,
            }
        agg[key]["pallet_ids"].add(str(pallet.id))
        agg[key]["weight_kg"] += float(batch.weight_kg)

    # Resolve colors from suppliers/customers tables (canvas_color_hex column)
    cust_colors = dict(
        db.query(Customer.id, Customer.canvas_color_hex)
        .filter(Customer.company_id == current_user.company_id)
        .all()
    )
    sup_colors = dict(
        db.query(Supplier.id, Supplier.canvas_color_hex)
        .filter(Supplier.company_id == current_user.company_id)
        .all()
    )

    # Stable pool of fallback colors for clients that haven't been given one yet
    FALLBACKS = [
        "#0ea5e9", "#8b5cf6", "#f43f5e", "#10b981", "#f59e0b",
        "#ec4899", "#22d3ee", "#84cc16", "#a855f7", "#ef4444",
    ]
    sorted_keys = sorted(agg.keys(), key=lambda k: (k[2] or "").lower())
    fallback_idx = 0

    out = []
    for key in sorted_keys:
        info = agg[key]
        client_id = key[0]
        if client_id:
            color = (
                cust_colors.get(uuid.UUID(client_id))
                or sup_colors.get(uuid.UUID(client_id))
                or None
            )
        else:
            color = None
        if not color:
            color = FALLBACKS[fallback_idx % len(FALLBACKS)]
            fallback_idx += 1

        info["color_hex"] = color
        info["pallet_count"] = len(info["pallet_ids"])
        info["pallet_ids"] = sorted(info["pallet_ids"])
        out.append(info)

    return out


# ── Multi-layout management ──────────────────────────────────────────────────


def _serialize_layout_summary(layout: WarehouseLayout) -> dict:
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


@router.get("/branches/{branch_id}/layouts")
def list_branch_layouts(
    branch_id: uuid.UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all warehouse layouts for a branch."""
    branch = db.get(Branch, branch_id)
    if not branch or branch.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Branch not found")
    layouts = (
        db.query(WarehouseLayout)
        .filter(WarehouseLayout.branch_id == branch_id)
        .order_by(WarehouseLayout.created_at)
        .all()
    )
    return [_serialize_layout_summary(l) for l in layouts]


class LayoutCreate(BaseModel):
    name: str
    # Either pick a named preset (small/medium/large/commercial) OR supply
    # explicit width_m/height_m. Explicit values win when both are sent.
    size_preset: str | None = None
    width_m: float | None = None
    height_m: float | None = None
    grid_size_m: float = 0.5
    seed_default_zones: bool = True


@router.get("/warehouse-size-presets")
def list_warehouse_size_presets():
    """Catalogue of stock commercial warehouse footprints exposed to the UI
    so the New-layout form can render a size picker without hard-coding."""
    return [
        {
            "code": code,
            "label": code.capitalize(),
            **spec,
            "floor_area_m2": round(spec["width_m"] * spec["height_m"]),
        }
        for code, spec in WAREHOUSE_SIZE_PRESETS.items()
    ]


@router.post("/branches/{branch_id}/layouts", status_code=201)
def create_branch_layout(
    branch_id: uuid.UUID,
    body: LayoutCreate,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Create a new warehouse layout for a branch (does not change the default)."""
    branch = db.get(Branch, branch_id)
    if not branch or branch.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Branch not found")

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    # Resolve dimensions: explicit body values win; otherwise consult preset;
    # otherwise fall back to commercial default.
    preset = WAREHOUSE_SIZE_PRESETS.get((body.size_preset or "commercial").lower())
    if body.size_preset and not preset:
        raise HTTPException(
            status_code=400,
            detail=f"unknown size_preset '{body.size_preset}'. Use one of: {', '.join(WAREHOUSE_SIZE_PRESETS)}",
        )
    width_m = body.width_m if body.width_m is not None else (preset or {}).get("width_m", DEFAULT_LAYOUT_WIDTH_M)
    height_m = body.height_m if body.height_m is not None else (preset or {}).get("height_m", DEFAULT_LAYOUT_HEIGHT_M)

    if width_m < 5 or width_m > 200:
        raise HTTPException(status_code=400, detail="width_m must be 5–200")
    if height_m < 5 or height_m > 200:
        raise HTTPException(status_code=400, detail="height_m must be 5–200")
    if body.grid_size_m < 0.1 or body.grid_size_m > 2.0:
        raise HTTPException(status_code=400, detail="grid_size_m must be 0.1–2.0")

    existing = db.query(WarehouseLayout).filter(WarehouseLayout.branch_id == branch_id).count()
    layout = WarehouseLayout(
        branch_id=branch.id,
        company_id=branch.company_id,
        name=name,
        is_default=existing == 0,
        width_m=Decimal(str(round(width_m, 2))),
        height_m=Decimal(str(round(height_m, 2))),
        grid_size_m=Decimal(str(round(body.grid_size_m, 2))),
    )
    db.add(layout)
    db.flush()

    if body.seed_default_zones:
        # Zones are computed proportionally so they fit ANY chosen footprint —
        # a 15×35 small mill gets the same six bands as a 30×120 commercial one,
        # just scaled to fit.
        for ztype, zname, x, y, w, h, color in _compute_default_zones(width_m, height_m):
            db.add(WarehouseZone(
                layout_id=layout.id,
                zone_type=ztype,
                name=zname,
                x_m=Decimal(str(x)), y_m=Decimal(str(y)),
                width_m=Decimal(str(w)), height_m=Decimal(str(h)),
                color_hex=color,
            ))

    db.commit()
    db.refresh(layout)
    return _serialize_layout_summary(layout)


@router.patch("/layouts/{layout_id}/set-default")
def set_default_layout(
    layout_id: uuid.UUID,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Mark a layout as the default for its branch (unmarks any previous default)."""
    layout = db.get(WarehouseLayout, layout_id)
    if not layout or layout.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Layout not found")

    db.query(WarehouseLayout).filter(
        WarehouseLayout.branch_id == layout.branch_id,
        WarehouseLayout.id != layout_id,
    ).update({"is_default": False})
    layout.is_default = True
    db.commit()
    return _serialize_layout_summary(layout)


@router.delete("/layouts/{layout_id}", status_code=204)
def delete_layout(
    layout_id: uuid.UUID,
    current_user=Depends(require_roles(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    """Delete a layout and all its zones/pallets.

    Cannot delete the last layout for a branch; cannot delete while pallets
    exist in the layout (move or discard them first).
    """
    layout = db.get(WarehouseLayout, layout_id)
    if not layout or layout.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Layout not found")

    sibling_count = db.query(WarehouseLayout).filter(
        WarehouseLayout.branch_id == layout.branch_id
    ).count()
    if sibling_count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only layout for a branch")

    pallet_count = db.query(Pallet).filter(Pallet.layout_id == layout_id).count()
    if pallet_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Layout has {pallet_count} pallets — move or discard them before deleting",
        )

    was_default = layout.is_default
    db.delete(layout)
    db.flush()

    if was_default:
        sibling = db.query(WarehouseLayout).filter(
            WarehouseLayout.branch_id == layout.branch_id
        ).first()
        if sibling:
            sibling.is_default = True

    db.commit()


@router.get("/dispatch/variety-options")
def dispatch_variety_options(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Varieties currently in stock (any pallet has a batch of it).
    Useful for the dispatch modal's dropdown.
    """
    rows = (
        db.query(RiceVariety)
        .join(RiceBatch, RiceBatch.variety_id == RiceVariety.id)
        .filter(RiceBatch.company_id == current_user.company_id)
        .distinct()
        .order_by(RiceVariety.code)
        .all()
    )
    return [{"id": str(v.id), "code": v.code, "name": v.name} for v in rows]
