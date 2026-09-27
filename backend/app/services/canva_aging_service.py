"""AgingReportService — aging heatmap + rack/grid view for the canva (Phase 4.3).

Two read aggregations over one branch's warehouse:

* ``aging_report`` — per-zone + per-aging-state pallet/weight rollups behind the
  heatmap, plus the 5 oldest pallets and the expired list.
* ``rack_view`` — zones-as-racks occupancy + aging rollups with oldest-first
  pallet lists (the "New Warehouse" list view). Like the canva read, it
  auto-bootstraps and refreshes aging on every read.

Logic preserved verbatim from ``api/canva.py``.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError
from ..models.company import Branch
from ..models.warehouse import WarehouseLayout
from ..repositories.canva import (
    PalletRepository,
    RiceBatchRepository,
    WarehouseLayoutRepository,
    WarehouseZoneRepository,
)
from .base import BaseService
from .canva_bootstrap import bootstrap_layout, bootstrap_pallets_from_inventory
from .canva_serializers import is_storage_zone, serialize_rack_pallet
from .rice_shelf_life import aging_status

_AGING_RANK = {"expired": 3, "critical": 2, "warning": 1, "fresh": 0}


class AgingReportService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        layouts: WarehouseLayoutRepository,
        zones: WarehouseZoneRepository,
        pallets: PalletRepository,
        batches: RiceBatchRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.layouts = layouts
        self.zones = zones
        self.pallets = pallets
        self.batches = batches

    # ── helpers (shared shape with CanvaLayoutService, kept self-contained) ────

    def _require_branch(self, branch_id: uuid.UUID) -> Branch:
        branch = self.db.get(Branch, branch_id)
        if not branch or branch.company_id != self.current_user.company_id:
            raise NotFoundError("Branch not found")
        return branch

    def _get_or_bootstrap(self, branch: Branch) -> WarehouseLayout:
        layout = self.layouts.get_default_for_branch(branch.id)
        if not layout:
            with self.transaction():
                layout = bootstrap_layout(self.db, branch, is_default=True)
                bootstrap_pallets_from_inventory(self.db, layout)
            self.db.refresh(layout)
        return layout

    def _refresh_aging(self, company_id: uuid.UUID, today: date) -> None:
        with self.transaction():
            for batch in self.batches.list_for_company(company_id):
                new_status = aging_status(batch.milling_date, batch.moisture_pct, today)
                if batch.status != new_status:
                    batch.status = new_status

    # ── aging report ──────────────────────────────────────────────────────────

    def aging_report(self, branch_id: uuid.UUID) -> dict:
        branch = self._require_branch(branch_id)
        layout = self.layouts.first_for_branch(branch_id)
        if not layout:
            raise NotFoundError("No warehouse layout for this branch")

        zones = self.zones.list_for_layout(layout.id)
        pallets = self.pallets.list_for_layout_variety(layout.id)

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
            statuses = [b.status for b in p.batches]
            worst = max(statuses, key=lambda s: _AGING_RANK.get(s, 0)) if statuses else "fresh"
            bucket = per_zone.get(str(p.zone_id) if p.zone_id else None, per_zone[None])
            bucket["pallet_count"] += 1
            bucket["weight_kg"] += float(p.weight_kg)
            bucket["by_aging"][worst] += 1
            totals[worst] += 1

            for b in p.batches:
                oldest.append(
                    {
                        "pallet_id": str(p.id),
                        "pallet_code": p.pallet_code,
                        "variety_code": b.variety.code if b.variety else None,
                        "milling_date": b.milling_date.isoformat(),
                        "days_old": (today - b.milling_date).days,
                        "best_before_date": b.best_before_date.isoformat() if b.best_before_date else None,
                        "weight_kg": float(b.weight_kg),
                        "status": b.status,
                    }
                )

        for bucket in per_zone.values():
            if bucket["max_weight_kg"]:
                bucket["utilization_pct"] = round(100.0 * bucket["weight_kg"] / bucket["max_weight_kg"], 1)

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

    # ── rack/grid view ────────────────────────────────────────────────────────

    def rack_view(self, branch_id: uuid.UUID, layout_id: uuid.UUID | None = None) -> dict:
        branch = self._require_branch(branch_id)

        if layout_id:
            layout = self.layouts.get_for_branch(layout_id, branch_id)
            if not layout:
                raise NotFoundError("Layout not found")
        else:
            layout = self._get_or_bootstrap(branch)
        today = date.today()

        # Keep aging colors current on every read (mirrors get_canva).
        self._refresh_aging(branch.company_id, today)

        zones = self.zones.list_for_layout(layout.id)
        pallets = self.pallets.list_for_layout_full(layout.id)

        # Group pallets by zone_id
        by_zone: dict[str | None, list] = {}
        for p in pallets:
            key = str(p.zone_id) if p.zone_id else None
            by_zone.setdefault(key, []).append(p)

        def _empty_aging() -> dict:
            return {"fresh": 0, "warning": 0, "critical": 0, "expired": 0}

        racks: list[dict] = []
        totals_aging = _empty_aging()
        capacity_kg = 0.0

        for z in zones:
            if not is_storage_zone(z.zone_type):
                continue  # walls/doors/walkways never hold pallets
            zone_pallets = by_zone.get(str(z.id), [])
            rows = [serialize_rack_pallet(p, today) for p in zone_pallets]
            rows.sort(key=lambda r: r["milling_date"])  # oldest first (FIFO)
            used_kg = sum(r["weight_kg"] for r in rows)
            cap = float(z.max_weight_kg) if z.max_weight_kg else None
            if cap:
                capacity_kg += cap
            by_aging = _empty_aging()
            for r in rows:
                by_aging[r["aging_status"]] += 1
                totals_aging[r["aging_status"]] += 1
            racks.append(
                {
                    "zone_id": str(z.id),
                    "name": z.name,
                    "zone_type": z.zone_type,
                    "color_hex": z.color_hex,
                    "capacity_kg": cap,
                    "used_kg": used_kg,
                    "occupancy_pct": round(100.0 * used_kg / cap, 1) if cap else None,
                    "pallet_count": len(rows),
                    "by_aging": by_aging,
                    "pallets": rows,
                }
            )

        # Pallets with no zone assignment
        unzoned_rows = [serialize_rack_pallet(p, today) for p in by_zone.get(None, [])]
        unzoned_rows.sort(key=lambda r: r["milling_date"])
        for r in unzoned_rows:
            totals_aging[r["aging_status"]] += 1

        total_weight = sum(float(p.weight_kg) for p in pallets)
        return {
            "layout": {
                "id": str(layout.id),
                "name": layout.name,
                "branch_name": branch.name,
            },
            "summary": {
                "total_pallets": len(pallets),
                "total_weight_kg": total_weight,
                "capacity_kg": capacity_kg or None,
                "occupancy_pct": round(100.0 * total_weight / capacity_kg, 1) if capacity_kg else None,
                "by_aging": totals_aging,
            },
            "racks": racks,
            "unzoned": unzoned_rows,
        }
