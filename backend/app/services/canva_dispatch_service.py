"""CanvaDispatchService — FIFO dispatch recommender for the canva (Phase 4.3).

Given a target weight (and optional variety / branch), returns the ordered list
of in-storage pallets to pull oldest-first that together cover it, skipping any
pallet that has something stacked on top. Also lists the varieties currently in
stock for the dispatch modal's dropdown. Read-only; logic preserved verbatim from
``api/canva.py``.

(Named ``CanvaDispatchService`` to avoid colliding with the unrelated
``services.dispatch_service.DispatchService`` — agents/millers/couriers.)
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from ..models.reference import RiceVariety
from ..repositories.canva import PalletRepository, RiceBatchRepository, WarehouseLayoutRepository
from .base import BaseService


class CanvaDispatchService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        pallets: PalletRepository,
        layouts: WarehouseLayoutRepository,
        batches: RiceBatchRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.pallets = pallets
        self.layouts = layouts
        self.batches = batches

    def _resolve_variety_id(self, body) -> uuid.UUID | None:
        if body.variety_id:
            return body.variety_id
        if body.variety_code:
            v = self.db.query(RiceVariety).filter(RiceVariety.code == body.variety_code).first()
            if v:
                return v.id
        return None

    def recommend_fifo(self, body) -> dict:
        """Ordered list of pallets to pull (oldest milling_date first) covering ``weight_kg``."""
        company_id = self.current_user.company_id
        variety_id = self._resolve_variety_id(body)

        layout_id: uuid.UUID | None = None
        if body.branch_id:
            layout = self.layouts.first_for_branch_company(body.branch_id, company_id)
            if layout:
                layout_id = layout.id

        rows = self.pallets.fifo_candidates(company_id, variety_id=variety_id, layout_id=layout_id)

        # Dedupe by pallet (keep oldest batch's date as "age")
        by_pallet: dict[uuid.UUID, tuple] = {}
        for p, b in rows:
            if p.id not in by_pallet or b.milling_date < by_pallet[p.id][1].milling_date:
                by_pallet[p.id] = (p, b)

        # Filter out pallets that have something stacked on top — can't extract
        children_set = self.pallets.parent_ids_in_use()

        candidates = sorted(by_pallet.values(), key=lambda pb: pb[1].milling_date)
        chosen: list[tuple] = []
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

    def variety_options(self) -> list[dict]:
        """Varieties currently in stock (any pallet has a batch of it)."""
        rows = self.batches.varieties_in_stock(self.current_user.company_id)
        return [{"id": str(v.id), "code": v.code, "name": v.name} for v in rows]
