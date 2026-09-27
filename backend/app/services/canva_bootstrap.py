"""Layout/zone/pallet bootstrap for the warehouse-canva domain (Phase 4.3).

Moved verbatim from ``api/canva.py``: the default-layout template, the
proportional zone generator, the warehouse size presets, and the day-one
bootstrap that synthesizes virtual pallets from a branch's milled-rice inventory.

These helpers ``add``/``flush`` only — they NEVER commit. The calling service
wraps a bootstrap in ``BaseService.transaction()`` (matching the original, which
committed exactly once after bootstrapping).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session, joinedload

from ..models.company import Branch
from ..models.milling import MilledRiceInventory
from ..models.warehouse import Pallet, RiceBatch, WarehouseLayout, WarehouseZone
from .rice_shelf_life import aging_status, compute_best_before

# ── Default layout template ──────────────────────────────────────────────────
# Standard rice-mill warehouse footprints, sized to actual industry capacity.
# Defaults to "commercial" so new tenants get the biggest canva to scale into.
DEFAULT_LAYOUT_WIDTH_M = 30.0
DEFAULT_LAYOUT_HEIGHT_M = 120.0

WAREHOUSE_SIZE_PRESETS: dict[str, dict] = {
    # capacity_label is shown to users alongside the dimensions
    "small": {"width_m": 15.0, "height_m": 35.0, "capacity_label": "1–2 t/h"},
    "medium": {"width_m": 18.0, "height_m": 60.0, "capacity_label": "3–5 t/h"},
    "large": {"width_m": 24.0, "height_m": 80.0, "capacity_label": "6–10 t/h"},
    "commercial": {"width_m": 30.0, "height_m": 120.0, "capacity_label": ">10 t/h"},
}

# Standard pallet: 25 sacks × 50kg = 1,250kg
SACKS_PER_PALLET = 25
KG_PER_SACK = 50
KG_PER_PALLET = SACKS_PER_PALLET * KG_PER_SACK


def compute_default_zones(width_m: float, height_m: float) -> list[tuple]:
    """Generate a proportional default-zone layout that scales to any warehouse
    footprint. Zones flow front-to-back along the long axis:
    receive → dry → mill → premium+customer storage (side-by-side) → general → ship.

    Returns a list of (zone_type, name, x_m, y_m, w_m, h_m, color_hex) tuples.
    Coords are clamped to fit inside `width_m × height_m` with a 1 m margin.
    """
    pad = 1.0
    w = max(width_m - 2 * pad, 1.0)  # usable width
    h = max(height_m - 2 * pad, 1.0)  # usable depth

    # Front-to-back band proportions of the usable depth
    BAND = [
        ("paddy_intake", "Paddy Intake", 0.10, "#fbbf24"),
        ("drying", "Drying Area", 0.08, "#f59e0b"),
        ("milling", "Milling Floor", 0.18, "#94a3b8"),
        ("storage_split", None, 0.30, None),
        ("general", "General Storage", 0.25, "#a78bfa"),
        ("shipping_dock", "Shipping Dock", 0.09, "#ec4899"),
    ]
    out: list[tuple] = []
    y = pad
    for ztype, name, frac, color in BAND:
        band_h = round(h * frac, 2)
        if ztype == "storage_split":
            half = round(w / 2 - 0.5, 2)
            out.append(("premium_storage", "Premium Storage", pad, y, half, band_h, "#10b981"))
            out.append(("customer_storage", "Customer Holding", pad + half + 1, y, half, band_h, "#3b82f6"))
        else:
            out.append((ztype, name, pad, y, w, band_h, color))
        y = round(y + band_h, 2)
    return out


# Kept for backward-compat — any older callsite that reads this static list now
# gets a freshly-computed default-size zone set instead of stale 30×20 coords.
DEFAULT_ZONES = compute_default_zones(DEFAULT_LAYOUT_WIDTH_M, DEFAULT_LAYOUT_HEIGHT_M)


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


def bootstrap_layout(db: Session, branch: Branch, name: str | None = None, is_default: bool = True) -> WarehouseLayout:
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
        db.add(
            WarehouseZone(
                layout_id=layout.id,
                zone_type=ztype,
                name=name,
                x_m=Decimal(str(x)),
                y_m=Decimal(str(y)),
                width_m=Decimal(str(w)),
                height_m=Decimal(str(h)),
                color_hex=color,
            )
        )
    db.flush()
    return layout


def bootstrap_pallets_from_inventory(db: Session, layout: WarehouseLayout) -> int:
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
            assumed_milling = today - timedelta(days=30)
            moisture = Decimal("13.5")  # safe assumption for milled bigas
            best_before = compute_best_before(assumed_milling, moisture)
            status_now = aging_status(assumed_milling, moisture, today)

            db.add(
                RiceBatch(
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
                )
            )
            slot += 1
            created += 1
        if remaining > 0.01:
            # We ran out of zone space; rest stays as untracked inventory
            break

    db.flush()
    return created
