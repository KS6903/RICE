"""CanvaLayoutService — layout/zone structure + canva reads (Phase 4.3).

Owns the main canva read (with day-one auto-bootstrap and the read-time aging
refresh), the zone CRUD + zone-type taxonomy, the full layout lifecycle
(create / list / rename-resize / set-default / soft-delete + 30-day trash /
restore / bulk-delete / lazy purge), the warehouse size presets, and the
client-colour aggregation. Logic is preserved from ``api/canva.py``; commits move
into ``BaseService.transaction()`` and the broadcast call sites are kept verbatim.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import BadRequestError, ConflictError, NotFoundError, PermissionDeniedError
from ..models.company import Branch
from ..models.user import User
from ..models.warehouse import WarehouseLayout, WarehouseZone
from ..repositories.canva import (
    PalletRepository,
    RiceBatchRepository,
    WarehouseLayoutRepository,
    WarehouseZoneRepository,
)
from .base import BaseService
from .canva_bootstrap import (
    DEFAULT_LAYOUT_HEIGHT_M,
    DEFAULT_LAYOUT_WIDTH_M,
    WAREHOUSE_SIZE_PRESETS,
    bootstrap_layout,
    bootstrap_pallets_from_inventory,
    compute_default_zones,
)
from .canva_realtime import manager as ws_manager
from .canva_serializers import (
    ALLOWED_ZONE_TYPES,
    STRUCTURAL_ZONE_TYPES,
    default_color_for,
    default_name_for,
    is_storage_zone,
    serialize_layout_summary,
    serialize_pallet,
    serialize_zone,
)
from .rice_shelf_life import aging_status

_LAYOUT_TRASH_DAYS = 30


class CanvaLayoutService(BaseService):
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

    # ── helpers ───────────────────────────────────────────────────────────────

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
        """Refresh batch status on every read so colors stay current as time passes."""
        with self.transaction():
            for batch in self.batches.list_for_company(company_id):
                new_status = aging_status(batch.milling_date, batch.moisture_pct, today)
                if batch.status != new_status:
                    batch.status = new_status

    def _layout_payload(self, layout: WarehouseLayout, branch: Branch) -> dict:
        return {
            "id": str(layout.id),
            "name": layout.name,
            "branch_id": str(layout.branch_id),
            "branch_name": branch.name,
            "width_m": float(layout.width_m),
            "height_m": float(layout.height_m),
            "grid_size_m": float(layout.grid_size_m),
            "version": layout.version,
        }

    # ── canva read ────────────────────────────────────────────────────────────

    def get_canva(self, branch_id: uuid.UUID, layout_id: uuid.UUID | None = None) -> dict:
        branch = self._require_branch(branch_id)

        if layout_id:
            layout = self.layouts.get_for_branch(layout_id, branch_id)
            if not layout:
                raise NotFoundError("Layout not found")
        else:
            layout = self._get_or_bootstrap(branch)
        today = date.today()

        self._refresh_aging(branch.company_id, today)

        zones = self.zones.list_for_layout(layout.id)
        pallets = self.pallets.list_for_layout_full(layout.id)

        return {
            "layout": self._layout_payload(layout, branch),
            "zones": [serialize_zone(z) for z in zones],
            "pallets": [serialize_pallet(p, today) for p in pallets],
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

    # ── zone-type taxonomy ────────────────────────────────────────────────────

    @staticmethod
    def zone_types() -> dict:
        return {
            "storage": [t for t in ALLOWED_ZONE_TYPES if t not in STRUCTURAL_ZONE_TYPES],
            "structural": [t for t in ALLOWED_ZONE_TYPES if t in STRUCTURAL_ZONE_TYPES],
        }

    # ── layout patch ──────────────────────────────────────────────────────────

    def patch_layout(self, branch_id: uuid.UUID, body, layout_id: uuid.UUID | None = None) -> dict:
        branch = self._require_branch(branch_id)
        if layout_id:
            layout = self.layouts.get_for_branch(layout_id, branch_id)
        else:
            layout = self.layouts.get_default_for_branch(branch_id)
        if not layout:
            raise NotFoundError("No warehouse layout for this branch")

        with self.transaction():
            if body.name is not None:
                layout.name = body.name.strip() or layout.name
            if body.width_m is not None:
                if body.width_m < 5 or body.width_m > 200:
                    raise BadRequestError("width_m must be between 5 and 200")
                layout.width_m = Decimal(str(round(body.width_m, 2)))
            if body.height_m is not None:
                if body.height_m < 5 or body.height_m > 200:
                    raise BadRequestError("height_m must be between 5 and 200")
                layout.height_m = Decimal(str(round(body.height_m, 2)))
            if body.grid_size_m is not None:
                if body.grid_size_m < 0.1 or body.grid_size_m > 2.0:
                    raise BadRequestError("grid_size_m must be between 0.1 and 2.0")
                layout.grid_size_m = Decimal(str(round(body.grid_size_m, 2)))
            layout.version += 1

        self.db.refresh(layout)
        payload = self._layout_payload(layout, branch)
        ws_manager.broadcast_sync(layout.id, "layout.updated", {"layout": payload, "by_user_id": str(self.current_user.id)})
        return payload

    # ── zone CRUD ─────────────────────────────────────────────────────────────

    def create_zone(self, branch_id: uuid.UUID, body, layout_id: uuid.UUID | None = None) -> dict:
        if body.zone_type not in ALLOWED_ZONE_TYPES:
            raise BadRequestError(f"Unknown zone_type '{body.zone_type}'")
        self._require_branch(branch_id)
        if layout_id:
            layout = self.layouts.get_for_branch(layout_id, branch_id)
        else:
            layout = self.layouts.get_default_for_branch(branch_id)
        if not layout:
            raise NotFoundError("No warehouse layout for this branch")

        lw, lh = float(layout.width_m), float(layout.height_m)
        is_structural = not is_storage_zone(body.zone_type)
        # Storage zones are clamped inside the floor; structural zones (door, wall,
        # walkway, loading_dock) may straddle or sit outside the boundary.
        w = max(0.5, body.width_m if is_structural else min(lw, body.width_m))
        h = max(0.5, body.height_m if is_structural else min(lh, body.height_m))
        x = body.x_m if is_structural else max(0.0, min(lw - w, body.x_m))
        y = body.y_m if is_structural else max(0.0, min(lh - h, body.y_m))

        color = body.color_hex or default_color_for(body.zone_type)
        zone = WarehouseZone(
            layout_id=layout.id,
            zone_type=body.zone_type,
            name=body.name.strip() or default_name_for(body.zone_type),
            x_m=Decimal(str(round(x, 2))),
            y_m=Decimal(str(round(y, 2))),
            width_m=Decimal(str(round(w, 2))),
            height_m=Decimal(str(round(h, 2))),
            color_hex=color,
            max_weight_kg=Decimal(str(body.max_weight_kg)) if body.max_weight_kg else None,
            notes=body.notes,
        )
        with self.transaction():
            self.zones.add(zone)
        self.db.refresh(zone)
        payload = serialize_zone(zone)
        ws_manager.broadcast_sync(layout.id, "zone.created", {"zone": payload, "by_user_id": str(self.current_user.id)})
        return payload

    def patch_zone(self, zone_id: uuid.UUID, body) -> dict:
        zone = self.zones.get(zone_id)
        if not zone:
            raise NotFoundError("Zone not found")
        layout = self.layouts.get_any(zone.layout_id)
        if not layout or layout.company_id != self.current_user.company_id:
            raise PermissionDeniedError("Zone belongs to another company")

        with self.transaction():
            if body.zone_type is not None:
                if body.zone_type not in ALLOWED_ZONE_TYPES:
                    raise BadRequestError(f"Unknown zone_type '{body.zone_type}'")
                # Converting from storage → structural with pallets inside? Eject them
                # to "Unassigned" so they don't sit on a wall.
                if is_storage_zone(zone.zone_type) and not is_storage_zone(body.zone_type):
                    self.pallets.eject_from_zone(zone.id)
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
            is_structural = not is_storage_zone(zone.zone_type)
            new_w = max(0.5, new_w if is_structural else min(lw, new_w))
            new_h = max(0.5, new_h if is_structural else min(lh, new_h))
            new_x = new_x if is_structural else max(0.0, min(lw - new_w, new_x))
            new_y = new_y if is_structural else max(0.0, min(lh - new_h, new_y))
            zone.width_m = Decimal(str(round(new_w, 2)))
            zone.height_m = Decimal(str(round(new_h, 2)))
            zone.x_m = Decimal(str(round(new_x, 2)))
            zone.y_m = Decimal(str(round(new_y, 2)))

        self.db.refresh(zone)
        payload = serialize_zone(zone)
        ws_manager.broadcast_sync(layout.id, "zone.updated", {"zone": payload, "by_user_id": str(self.current_user.id)})
        return payload

    def delete_zone(self, zone_id: uuid.UUID) -> dict:
        zone = self.zones.get(zone_id)
        if not zone:
            raise NotFoundError("Zone not found")
        layout = self.layouts.get_any(zone.layout_id)
        if not layout or layout.company_id != self.current_user.company_id:
            raise PermissionDeniedError("Zone belongs to another company")
        layout_id = layout.id
        zid = zone.id
        with self.transaction():
            self.zones.delete(zone)
        ws_manager.broadcast_sync(layout_id, "zone.deleted", {"zone_id": str(zid), "by_user_id": str(self.current_user.id)})
        return {"message": "Zone deleted"}

    # ── multi-layout management ───────────────────────────────────────────────

    def list_branch_layouts(self, branch_id: uuid.UUID) -> list[dict]:
        self._require_branch(branch_id)
        layouts = self.layouts.list_live_for_branch(branch_id)
        return [serialize_layout_summary(l) for l in layouts]

    def _purge_expired_layouts(self, branch_id: uuid.UUID) -> None:
        """Hard-delete trashed layouts whose 30-day window has elapsed.
        Zones and pallets cascade via the ORM relationship."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=_LAYOUT_TRASH_DAYS)
        expired = self.layouts.expired_trashed_for_branch(branch_id, cutoff)
        if expired:
            with self.transaction():
                for l in expired:
                    self.layouts.delete(l)

    def list_trashed_layouts(self, branch_id: uuid.UUID) -> list[dict]:
        """Layouts in the 30-day trash. Lazily purges expired ones first."""
        self._require_branch(branch_id)
        self._purge_expired_layouts(branch_id)
        rows = self.layouts.list_trashed_for_branch(branch_id)
        deleter_ids = {r.deleted_by for r in rows if r.deleted_by}
        names: dict = {}
        if deleter_ids:
            for u in self.db.query(User).filter(User.id.in_(deleter_ids)).all():
                names[u.id] = u.full_name or u.username
        out = []
        for l in rows:
            expires_at = l.deleted_at + timedelta(days=_LAYOUT_TRASH_DAYS)
            days_remaining = max(0, (expires_at - datetime.now(timezone.utc)).days)
            out.append({
                "id": str(l.id),
                "name": l.name,
                "is_default": l.is_default,
                "width_m": float(l.width_m),
                "height_m": float(l.height_m),
                "deleted_at": l.deleted_at.isoformat(),
                "deleted_by_name": names.get(l.deleted_by),
                "days_remaining": days_remaining,
            })
        return out

    def restore_layout(self, layout_id: uuid.UUID) -> dict:
        layout = self.layouts.get_any(layout_id)
        if not layout or layout.company_id != self.current_user.company_id:
            raise NotFoundError("Layout not found")
        if layout.deleted_at is None:
            raise ConflictError("Layout is not in the trash.")
        with self.transaction():
            layout.deleted_at = None
            layout.deleted_by = None
        return {"restored": True, "id": str(layout.id)}

    def warehouse_size_presets(self) -> list[dict]:
        return [
            {
                "code": code,
                "label": code.capitalize(),
                **spec,
                "floor_area_m2": round(spec["width_m"] * spec["height_m"]),
            }
            for code, spec in WAREHOUSE_SIZE_PRESETS.items()
        ]

    def create_branch_layout(self, branch_id: uuid.UUID, body) -> dict:
        branch = self._require_branch(branch_id)

        name = body.name.strip()
        if not name:
            raise BadRequestError("name is required")

        # Resolve dimensions: explicit body values win; otherwise consult preset;
        # otherwise fall back to commercial default.
        preset = WAREHOUSE_SIZE_PRESETS.get((body.size_preset or "commercial").lower())
        if body.size_preset and not preset:
            raise BadRequestError(
                f"unknown size_preset '{body.size_preset}'. Use one of: {', '.join(WAREHOUSE_SIZE_PRESETS)}"
            )
        width_m = body.width_m if body.width_m is not None else (preset or {}).get("width_m", DEFAULT_LAYOUT_WIDTH_M)
        height_m = body.height_m if body.height_m is not None else (preset or {}).get("height_m", DEFAULT_LAYOUT_HEIGHT_M)

        if width_m < 5 or width_m > 200:
            raise BadRequestError("width_m must be 5–200")
        if height_m < 5 or height_m > 200:
            raise BadRequestError("height_m must be 5–200")
        if body.grid_size_m < 0.1 or body.grid_size_m > 2.0:
            raise BadRequestError("grid_size_m must be 0.1–2.0")

        existing = self.layouts.count_for_branch(branch_id)
        layout = WarehouseLayout(
            branch_id=branch.id,
            company_id=branch.company_id,
            name=name,
            is_default=existing == 0,
            width_m=Decimal(str(round(width_m, 2))),
            height_m=Decimal(str(round(height_m, 2))),
            grid_size_m=Decimal(str(round(body.grid_size_m, 2))),
        )
        with self.transaction():
            self.layouts.add(layout)
            if body.seed_default_zones:
                # Zones are computed proportionally so they fit ANY chosen footprint.
                for ztype, zname, x, y, w, h, color in compute_default_zones(width_m, height_m):
                    self.db.add(WarehouseZone(
                        layout_id=layout.id,
                        zone_type=ztype,
                        name=zname,
                        x_m=Decimal(str(x)), y_m=Decimal(str(y)),
                        width_m=Decimal(str(w)), height_m=Decimal(str(h)),
                        color_hex=color,
                    ))
        self.db.refresh(layout)
        return serialize_layout_summary(layout)

    def set_default_layout(self, layout_id: uuid.UUID) -> dict:
        layout = self.layouts.get_any(layout_id)
        if not layout or layout.company_id != self.current_user.company_id:
            raise NotFoundError("Layout not found")
        with self.transaction():
            self.layouts.clear_default_for_branch(layout.branch_id, layout.id)
            layout.is_default = True
        return serialize_layout_summary(layout)

    def delete_layout(self, layout_id: uuid.UUID) -> None:
        """Soft-delete a layout (moves it to the 30-day trash)."""
        layout = self.layouts.get_any(layout_id)
        if not layout or layout.company_id != self.current_user.company_id:
            raise NotFoundError("Layout not found")
        if layout.deleted_at is not None:
            raise ConflictError("Layout is already in the trash.")

        live_count = self.layouts.count_live_for_branch(layout.branch_id)
        if live_count <= 1:
            raise BadRequestError("Each warehouse must keep at least one layout.")

        with self.transaction():
            layout.deleted_at = datetime.now(timezone.utc)
            layout.deleted_by = self.current_user.id
            if layout.is_default:
                layout.is_default = False
                sibling = self.layouts.first_live_for_branch(layout.branch_id, exclude_id=layout.id)
                if sibling:
                    sibling.is_default = True

    def bulk_delete_layouts(self, body) -> dict:
        """Soft-delete (trash) multiple layouts at once. Keeps ≥1 live layout per branch."""
        now = datetime.now(timezone.utc)
        deleted: list[str] = []
        skipped: list[dict] = []
        # Track live layout count per branch as we process.
        live_counts: dict[uuid.UUID, int] = {}

        with self.transaction():
            for lid in body.ids:
                layout = self.layouts.get_any(lid)
                if not layout or layout.company_id != self.current_user.company_id:
                    skipped.append({"id": str(lid), "reason": "Layout not found."})
                    continue
                if layout.deleted_at is not None:
                    skipped.append({"id": str(lid), "reason": "Already in trash."})
                    continue
                bid = layout.branch_id
                if bid not in live_counts:
                    live_counts[bid] = self.layouts.count_live_for_branch(bid)
                if live_counts[bid] <= 1:
                    skipped.append({"id": str(lid), "reason": "Each warehouse must keep at least one layout."})
                    continue

                layout.deleted_at = now
                layout.deleted_by = self.current_user.id
                if layout.is_default:
                    layout.is_default = False
                live_counts[bid] -= 1
                deleted.append(str(lid))

            self.db.flush()

            # Promote a sibling to default for any branch that lost its default.
            for lid_str in deleted:
                layout = self.layouts.get_any(uuid.UUID(lid_str))
                if layout:
                    bid = layout.branch_id
                    has_default = self.layouts.count_default_live_for_branch(bid)
                    if not has_default:
                        sibling = self.layouts.first_live_for_branch(bid)
                        if sibling:
                            sibling.is_default = True

        return {"deleted": deleted, "skipped": skipped}

    # ── client-colour aggregation ─────────────────────────────────────────────

    def list_canva_customers(self, branch_id: uuid.UUID | None = None) -> list[dict]:
        """Distinct clients with active pallets in the canva, with their assigned
        canva color and occupancy stats. Colors are tenant-unique and persisted
        back to the source row so they stick."""
        from ..models.supplier_customer import Customer, Supplier
        from ..models.dispatch import Agent, Miller
        from .canva_color import pick_unused_color

        company_id = self.current_user.company_id
        layout_ids = None
        if branch_id:
            ids = self.layouts.ids_for_branch_company(branch_id, company_id)
            if ids:
                layout_ids = ids

        rows = self.batches.batches_with_pallets(company_id, layout_ids=layout_ids)

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

        # Resolve colors from all four party tables (shared tenant-wide pool).
        cust_colors = dict(self.db.query(Customer.id, Customer.canva_color_hex).filter(Customer.company_id == company_id).all())
        sup_colors = dict(self.db.query(Supplier.id, Supplier.canva_color_hex).filter(Supplier.company_id == company_id).all())
        agent_colors = dict(self.db.query(Agent.id, Agent.canva_color_hex).filter(Agent.company_id == company_id).all())
        miller_colors = dict(self.db.query(Miller.id, Miller.canva_color_hex).filter(Miller.company_id == company_id).all())

        # Sorted iteration so fallback color assignment is deterministic per request.
        sorted_keys = sorted(agg.keys(), key=lambda k: (k[2] or "").lower())

        def _persist_color(table: type, row_id: uuid.UUID, lookup: dict) -> str:
            existing = lookup.get(row_id)
            if existing:
                return existing
            color = pick_unused_color(self.db, company_id)
            obj = self.db.get(table, row_id)
            if obj is not None:
                obj.canva_color_hex = color
                lookup[row_id] = color
            return color

        dirty = False
        out = []
        for key in sorted_keys:
            info = agg[key]
            client_id_str = key[0]
            client_type = (key[1] or "").lower()
            color: str | None = None
            if client_id_str:
                try:
                    cid = uuid.UUID(client_id_str)
                except (ValueError, AttributeError):
                    cid = None
                if cid is not None:
                    if client_type == "agent":
                        color = _persist_color(Agent, cid, agent_colors)
                        dirty = dirty or color == agent_colors.get(cid)
                    elif client_type == "miller":
                        color = _persist_color(Miller, cid, miller_colors)
                        dirty = dirty or color == miller_colors.get(cid)
                    elif client_type == "customer":
                        color = _persist_color(Customer, cid, cust_colors)
                        dirty = dirty or color == cust_colors.get(cid)
                    elif client_type == "supplier":
                        color = _persist_color(Supplier, cid, sup_colors)
                        dirty = dirty or color == sup_colors.get(cid)
                    else:
                        # Unknown client_type — try every table as a fallback so
                        # legacy data keeps working.
                        color = (
                            cust_colors.get(cid)
                            or sup_colors.get(cid)
                            or agent_colors.get(cid)
                            or miller_colors.get(cid)
                        )
            if not color:
                # No identifiable party row (e.g. client_type="mill_own"). Pick a
                # tenant-unique color from the pool — purely transient.
                color = pick_unused_color(self.db, company_id)

            info["color_hex"] = color
            info["pallet_count"] = len(info["pallet_ids"])
            info["pallet_ids"] = sorted(info["pallet_ids"])
            out.append(info)

        if dirty:
            with self.transaction():
                pass

        return out
