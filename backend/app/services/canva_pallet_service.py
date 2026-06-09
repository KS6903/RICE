"""PalletService — spatial pallet mutations for the warehouse canva (Phase 4.3).

Owns drag-to-move, resize, stack, unstack: footprint clamping, structural-zone
collision rejection, zone auto-assignment, the movement audit trail, and the
post-commit realtime broadcast. Logic is preserved from ``api/canva.py`` verbatim;
only the transaction boundary (now ``BaseService.transaction()``) and the error
type (now the AppException hierarchy) change. Every ``ws_manager.broadcast_sync``
call site is kept exactly — same event name and payload — and still fires once,
after the commit + refresh.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import AppException, BadRequestError, ConflictError, NotFoundError, PermissionDeniedError
from ..models.warehouse import Pallet, PalletMovement, WarehouseLayout, WarehouseZone
from ..repositories.canva import (
    PalletMovementRepository,
    PalletRepository,
    WarehouseLayoutRepository,
    WarehouseZoneRepository,
)
from .base import BaseService
from .canva_realtime import manager as ws_manager
from .canva_serializers import is_storage_zone, serialize_movement, serialize_pallet


class PalletService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        pallets: PalletRepository,
        layouts: WarehouseLayoutRepository,
        zones: WarehouseZoneRepository,
        movements: PalletMovementRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.pallets = pallets
        self.layouts = layouts
        self.zones = zones
        self.movements = movements

    # ── helpers (formerly module-level in api/canva.py) ───────────────────────

    def _ensure_owned(self, pallet_id: uuid.UUID) -> Pallet:
        p = self.pallets.get(pallet_id)
        if not p:
            raise NotFoundError("Pallet not found")
        if p.company_id != self.current_user.company_id:
            raise PermissionDeniedError("Pallet belongs to another company")
        return p

    def _require_layout(self, layout_id: uuid.UUID) -> WarehouseLayout:
        layout = self.layouts.get_any(layout_id)
        if not layout:
            raise AppException("Layout missing for pallet")
        return layout

    def _zone_containing(
        self, layout: WarehouseLayout, x_m: float, y_m: float, *, storage_only: bool = True
    ) -> WarehouseZone | None:
        """Find the zone whose bounding rectangle contains the point (x_m, y_m).

        By default ignores structural zones (walls, doors, walkways). Pass
        storage_only=False to consider every zone — used to detect dropping a
        pallet onto a wall so we can reject it.
        """
        zones = self.zones.list_for_layout(layout.id)
        # Iterate front-to-back: smaller zones drawn on top should win on overlap.
        # Sort by area ascending so the smallest match wins (typically what the eye picks).
        zones.sort(key=lambda z: float(z.width_m) * float(z.height_m))
        for z in zones:
            if storage_only and not is_storage_zone(z.zone_type):
                continue
            zx, zy = float(z.x_m), float(z.y_m)
            zw, zh = float(z.width_m), float(z.height_m)
            if zx <= x_m <= zx + zw and zy <= y_m <= zy + zh:
                return z
        return None

    def _structural_overlap(
        self, layout: WarehouseLayout, x_m: float, y_m: float, w_m: float, d_m: float
    ) -> WarehouseZone | None:
        """Return the first structural zone (wall/door/walkway/dock) whose
        rectangle overlaps the given pallet footprint. Used by the move-validator
        so even a partial collision with a wall is rejected."""
        zones = self.zones.list_for_layout(layout.id)
        for z in zones:
            if is_storage_zone(z.zone_type):
                continue
            zx, zy = float(z.x_m), float(z.y_m)
            zw, zh = float(z.width_m), float(z.height_m)
            # AABB intersection test
            if x_m < zx + zw and x_m + w_m > zx and y_m < zy + zh and y_m + d_m > zy:
                return z
        return None

    # ── operations ────────────────────────────────────────────────────────────

    def move(self, pallet_id: uuid.UUID, body) -> dict:
        """Reposition a pallet to (x_m, y_m). Auto-assigns the zone the point falls into."""
        pallet = self._ensure_owned(pallet_id)
        layout = self._require_layout(pallet.layout_id)

        # Don't allow moving a pallet that has others stacked on top
        if self.pallets.stacked_child_of(pallet.id):
            raise ConflictError("Cannot move: another pallet is stacked on this one. Unstack it first.")

        # Clamp to layout bounds with a small margin
        margin = 0.1
        lw, lh = float(layout.width_m), float(layout.height_m)
        new_x = max(margin, min(lw - float(pallet.width_m) - margin, body.x_m))
        new_y = max(margin, min(lh - float(pallet.depth_m) - margin, body.y_m))

        # Reject if any part of the pallet footprint overlaps a structural element.
        pw, pd = float(pallet.width_m), float(pallet.depth_m)
        structural_hit = self._structural_overlap(layout, new_x, new_y, pw, pd)
        if structural_hit:
            raise ConflictError(
                f"Cannot drop a pallet on a {structural_hit.zone_type.replace('_', ' ')} "
                f"('{structural_hit.name}'). Move it to a storage area instead."
            )

        from_x, from_y = float(pallet.x_m), float(pallet.y_m)
        from_zone_id = pallet.zone_id
        new_zone = self._zone_containing(layout, new_x, new_y)

        with self.transaction():
            pallet.x_m = Decimal(str(round(new_x, 2)))
            pallet.y_m = Decimal(str(round(new_y, 2)))
            pallet.zone_id = new_zone.id if new_zone else None
            # If this pallet was stacked, dropping it elsewhere implicitly unstacks
            if pallet.stack_parent_id:
                pallet.stack_parent_id = None
                pallet.z_layer = 0
            self.movements.add(PalletMovement(
                pallet_id=pallet.id,
                user_id=self.current_user.id,
                movement_type="move",
                from_x_m=Decimal(str(round(from_x, 2))),
                from_y_m=Decimal(str(round(from_y, 2))),
                to_x_m=pallet.x_m,
                to_y_m=pallet.y_m,
                from_zone_id=from_zone_id,
                to_zone_id=pallet.zone_id,
            ))

        self.db.refresh(pallet)
        payload = serialize_pallet(pallet, date.today())
        ws_manager.broadcast_sync(pallet.layout_id, "pallet.moved", {"pallet": payload, "by_user_id": str(self.current_user.id)})
        return payload

    def resize(self, pallet_id: uuid.UUID, body) -> dict:
        """Resize a pallet's footprint. Clamps to layout bounds and refuses overlaps
        with structural elements at the new size."""
        pallet = self._ensure_owned(pallet_id)
        layout = self._require_layout(pallet.layout_id)

        # Sensible footprint limits — small enough to fit any zone, big enough to read
        if body.width_m < 0.4 or body.width_m > 6.0:
            raise BadRequestError("width_m must be between 0.4 and 6.0")
        if body.depth_m < 0.4 or body.depth_m > 6.0:
            raise BadRequestError("depth_m must be between 0.4 and 6.0")

        margin = 0.05
        lw, lh = float(layout.width_m), float(layout.height_m)
        new_w = round(min(body.width_m, max(0.4, lw - float(pallet.x_m) - margin)), 2)
        new_d = round(min(body.depth_m, max(0.4, lh - float(pallet.y_m) - margin)), 2)

        structural_hit = self._structural_overlap(layout, float(pallet.x_m), float(pallet.y_m), new_w, new_d)
        if structural_hit:
            raise ConflictError(
                f"New size would overlap a {structural_hit.zone_type.replace('_', ' ')} ('{structural_hit.name}')."
            )

        with self.transaction():
            pallet.width_m = Decimal(str(new_w))
            pallet.depth_m = Decimal(str(new_d))

        self.db.refresh(pallet)
        payload = serialize_pallet(pallet, date.today())
        ws_manager.broadcast_sync(pallet.layout_id, "pallet.moved", {"pallet": payload, "by_user_id": str(self.current_user.id)})
        return payload

    def stack(self, pallet_id: uuid.UUID, body) -> dict:
        """Stack ``pallet_id`` on top of ``parent_pallet_id``."""
        if pallet_id == body.parent_pallet_id:
            raise BadRequestError("A pallet cannot stack on itself.")

        pallet = self._ensure_owned(pallet_id)
        parent = self._ensure_owned(body.parent_pallet_id)

        if pallet.layout_id != parent.layout_id:
            raise BadRequestError("Pallets are in different warehouses.")

        # Don't allow stacking if this pallet has children already (would need to bring its stack along)
        if self.pallets.stacked_child_of(pallet.id):
            raise ConflictError("Cannot stack: this pallet already has others on top of it.")

        # Don't allow more than 4 layers high (typical warehouse safety limit for rice sacks)
        if parent.z_layer >= 3:
            raise ConflictError("Stack height limit reached (max 4 layers).")

        from_x, from_y = float(pallet.x_m), float(pallet.y_m)
        from_zone_id = pallet.zone_id

        with self.transaction():
            pallet.stack_parent_id = parent.id
            pallet.z_layer = parent.z_layer + 1
            pallet.x_m = parent.x_m
            pallet.y_m = parent.y_m
            pallet.zone_id = parent.zone_id
            self.movements.add(PalletMovement(
                pallet_id=pallet.id,
                user_id=self.current_user.id,
                movement_type="stack",
                from_x_m=Decimal(str(round(from_x, 2))),
                from_y_m=Decimal(str(round(from_y, 2))),
                to_x_m=pallet.x_m,
                to_y_m=pallet.y_m,
                from_zone_id=from_zone_id,
                to_zone_id=pallet.zone_id,
                notes=f"Stacked on {parent.pallet_code}",
            ))

        self.db.refresh(pallet)
        payload = serialize_pallet(pallet, date.today())
        ws_manager.broadcast_sync(pallet.layout_id, "pallet.stacked", {"pallet": payload, "parent_id": str(parent.id), "by_user_id": str(self.current_user.id)})
        return payload

    def unstack(self, pallet_id: uuid.UUID, body) -> dict:
        """Pop a pallet off its stack. If x_m/y_m given, place it there; otherwise drop beside parent."""
        pallet = self._ensure_owned(pallet_id)
        if not pallet.stack_parent_id:
            raise BadRequestError("Pallet is not stacked.")

        layout = self._require_layout(pallet.layout_id)

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

        new_zone = self._zone_containing(layout, new_x, new_y)

        with self.transaction():
            pallet.x_m = Decimal(str(round(new_x, 2)))
            pallet.y_m = Decimal(str(round(new_y, 2)))
            pallet.zone_id = new_zone.id if new_zone else None
            pallet.stack_parent_id = None
            pallet.z_layer = 0
            self.movements.add(PalletMovement(
                pallet_id=pallet.id,
                user_id=self.current_user.id,
                movement_type="unstack",
                from_x_m=Decimal(str(round(from_x, 2))),
                from_y_m=Decimal(str(round(from_y, 2))),
                to_x_m=pallet.x_m,
                to_y_m=pallet.y_m,
                to_zone_id=pallet.zone_id,
            ))

        self.db.refresh(pallet)
        payload = serialize_pallet(pallet, date.today())
        ws_manager.broadcast_sync(pallet.layout_id, "pallet.unstacked", {"pallet": payload, "by_user_id": str(self.current_user.id)})
        return payload

    def list_movements(self, pallet_id: uuid.UUID) -> list[dict]:
        pallet = self._ensure_owned(pallet_id)
        rows = self.movements.list_for_pallet(pallet.id, limit=50)
        return [serialize_movement(m) for m in rows]
