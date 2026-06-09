"""Repositories for the warehouse-canva domain (Phase 4.2).

Data access for the spatial warehouse: layouts, zones, pallets, movement audit
log, and the rice batches inside pallets. Each method mirrors a query that lived
inline in ``api/canva.py`` so behavior is preserved exactly — note in particular
that the layout lookups are deliberately NOT uniformly soft-delete-filtered:
the by-id / default lookups include trashed layouts (the monolith used a bare
``db.get`` / unfiltered query there), while the list/count/purge helpers filter
on ``deleted_at`` explicitly, matching the original.

Writes flush only — the owning service commits via ``BaseService.transaction()``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Sequence

from sqlalchemy.orm import joinedload

from ..models.reference import RiceVariety
from ..models.warehouse import Pallet, PalletMovement, RiceBatch, WarehouseLayout, WarehouseZone
from .base import BaseRepository


class WarehouseLayoutRepository(BaseRepository[WarehouseLayout]):
    model = WarehouseLayout

    # ---- by-id / default lookups (include trashed, like the monolith) --------

    def get_any(self, layout_id: uuid.UUID) -> WarehouseLayout | None:
        """Bare PK fetch INCLUDING trashed layouts (mirrors ``db.get`` sites)."""
        return self.db.get(WarehouseLayout, layout_id)

    def get_for_branch(self, layout_id: uuid.UUID, branch_id: uuid.UUID) -> WarehouseLayout | None:
        return (
            self.db.query(WarehouseLayout)
            .filter(WarehouseLayout.id == layout_id, WarehouseLayout.branch_id == branch_id)
            .first()
        )

    def all_for_branch(self, branch_id: uuid.UUID) -> list[WarehouseLayout]:
        return self.db.query(WarehouseLayout).filter(WarehouseLayout.branch_id == branch_id).all()

    def get_default_for_branch(self, branch_id: uuid.UUID) -> WarehouseLayout | None:
        """The is_default layout for a branch, falling back to any layout."""
        layouts = self.all_for_branch(branch_id)
        if not layouts:
            return None
        return next((l for l in layouts if l.is_default), layouts[0])

    def first_for_branch(self, branch_id: uuid.UUID) -> WarehouseLayout | None:
        return self.db.query(WarehouseLayout).filter(WarehouseLayout.branch_id == branch_id).first()

    def first_for_branch_company(self, branch_id: uuid.UUID, company_id: uuid.UUID) -> WarehouseLayout | None:
        return (
            self.db.query(WarehouseLayout)
            .filter(WarehouseLayout.branch_id == branch_id, WarehouseLayout.company_id == company_id)
            .first()
        )

    def ids_for_branch_company(self, branch_id: uuid.UUID, company_id: uuid.UUID) -> list[uuid.UUID]:
        return [
            row.id
            for row in self.db.query(WarehouseLayout.id).filter(
                WarehouseLayout.branch_id == branch_id,
                WarehouseLayout.company_id == company_id,
            ).all()
        ]

    # ---- live / trashed lists ------------------------------------------------

    def list_live_for_branch(self, branch_id: uuid.UUID) -> list[WarehouseLayout]:
        return (
            self.db.query(WarehouseLayout)
            .filter(WarehouseLayout.branch_id == branch_id, WarehouseLayout.deleted_at.is_(None))
            .order_by(WarehouseLayout.created_at)
            .all()
        )

    def list_trashed_for_branch(self, branch_id: uuid.UUID) -> list[WarehouseLayout]:
        return (
            self.db.query(WarehouseLayout)
            .filter(WarehouseLayout.branch_id == branch_id, WarehouseLayout.deleted_at.isnot(None))
            .order_by(WarehouseLayout.deleted_at.desc())
            .all()
        )

    def expired_trashed_for_branch(self, branch_id: uuid.UUID, cutoff: datetime) -> list[WarehouseLayout]:
        return (
            self.db.query(WarehouseLayout)
            .filter(
                WarehouseLayout.branch_id == branch_id,
                WarehouseLayout.deleted_at.isnot(None),
                WarehouseLayout.deleted_at < cutoff,
            )
            .all()
        )

    # ---- counts / siblings ---------------------------------------------------

    def count_for_branch(self, branch_id: uuid.UUID) -> int:
        return self.db.query(WarehouseLayout).filter(WarehouseLayout.branch_id == branch_id).count()

    def count_live_for_branch(self, branch_id: uuid.UUID) -> int:
        return (
            self.db.query(WarehouseLayout)
            .filter(WarehouseLayout.branch_id == branch_id, WarehouseLayout.deleted_at.is_(None))
            .count()
        )

    def count_default_live_for_branch(self, branch_id: uuid.UUID) -> int:
        return (
            self.db.query(WarehouseLayout)
            .filter(
                WarehouseLayout.branch_id == branch_id,
                WarehouseLayout.deleted_at.is_(None),
                WarehouseLayout.is_default == True,  # noqa: E712 — SQL boolean, not Python
            )
            .count()
        )

    def first_live_for_branch(self, branch_id: uuid.UUID, *, exclude_id: uuid.UUID | None = None) -> WarehouseLayout | None:
        q = self.db.query(WarehouseLayout).filter(
            WarehouseLayout.branch_id == branch_id, WarehouseLayout.deleted_at.is_(None)
        )
        if exclude_id is not None:
            q = q.filter(WarehouseLayout.id != exclude_id)
        return q.first()

    def clear_default_for_branch(self, branch_id: uuid.UUID, except_id: uuid.UUID) -> None:
        self.db.query(WarehouseLayout).filter(
            WarehouseLayout.branch_id == branch_id,
            WarehouseLayout.id != except_id,
        ).update({"is_default": False})


class WarehouseZoneRepository(BaseRepository[WarehouseZone]):
    model = WarehouseZone

    def list_for_layout(self, layout_id: uuid.UUID) -> list[WarehouseZone]:
        return self.db.query(WarehouseZone).filter(WarehouseZone.layout_id == layout_id).all()

    def premium_for_layout(self, layout_id: uuid.UUID) -> WarehouseZone | None:
        return (
            self.db.query(WarehouseZone)
            .filter(WarehouseZone.layout_id == layout_id, WarehouseZone.zone_type == "premium_storage")
            .first()
        )


class PalletRepository(BaseRepository[Pallet]):
    model = Pallet

    def list_for_layout_full(self, layout_id: uuid.UUID) -> list[Pallet]:
        """Pallets with batches → variety AND grade eager-loaded (canva + rack-view)."""
        return (
            self.db.query(Pallet)
            .filter(Pallet.layout_id == layout_id)
            .options(
                joinedload(Pallet.batches).joinedload(RiceBatch.variety),
                joinedload(Pallet.batches).joinedload(RiceBatch.grade),
            )
            .all()
        )

    def list_for_layout_variety(self, layout_id: uuid.UUID) -> list[Pallet]:
        """Pallets with batches → variety eager-loaded (aging-report)."""
        return (
            self.db.query(Pallet)
            .filter(Pallet.layout_id == layout_id)
            .options(joinedload(Pallet.batches).joinedload(RiceBatch.variety))
            .all()
        )

    def stacked_child_of(self, pallet_id: uuid.UUID) -> Pallet | None:
        """First pallet stacked directly on top of ``pallet_id`` (or None)."""
        return self.db.query(Pallet).filter(Pallet.stack_parent_id == pallet_id).first()

    def parent_ids_in_use(self) -> set[uuid.UUID]:
        """Set of stack_parent_id for every stacked pallet — i.e. pallets that have
        something on top and so cannot be extracted (FIFO recommender)."""
        return {
            c.stack_parent_id
            for c in self.db.query(Pallet).filter(Pallet.stack_parent_id.isnot(None)).all()
            if c.stack_parent_id is not None
        }

    def eject_from_zone(self, zone_id: uuid.UUID) -> None:
        """Null the zone_id of every pallet in a zone (zone became structural / deleted)."""
        self.db.query(Pallet).filter(Pallet.zone_id == zone_id).update({Pallet.zone_id: None})

    def fifo_candidates(
        self,
        company_id: uuid.UUID,
        *,
        variety_id: uuid.UUID | None,
        layout_id: uuid.UUID | None,
    ) -> list[tuple[Pallet, RiceBatch]]:
        """(Pallet, RiceBatch) rows for in-storage stock, oldest milling_date first."""
        q = (
            self.db.query(Pallet, RiceBatch)
            .join(RiceBatch, RiceBatch.pallet_id == Pallet.id)
            .filter(Pallet.company_id == company_id, Pallet.status == "in_storage")
        )
        if layout_id is not None:
            q = q.filter(Pallet.layout_id == layout_id)
        if variety_id is not None:
            q = q.filter(RiceBatch.variety_id == variety_id)
        return q.order_by(RiceBatch.milling_date.asc(), Pallet.created_at.asc()).all()  # type: ignore[return-value]

    def next_pallet_code(self, company_id: uuid.UUID, year: int) -> str:
        """Next ``PL-<year>-NNNN`` code for a company (sequential per year)."""
        prefix = f"PL-{year}-"
        last = (
            self.db.query(Pallet)
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


class PalletMovementRepository(BaseRepository[PalletMovement]):
    model = PalletMovement

    def list_for_pallet(self, pallet_id: uuid.UUID, *, limit: int = 50) -> list[PalletMovement]:
        return (
            self.db.query(PalletMovement)
            .filter(PalletMovement.pallet_id == pallet_id)
            .order_by(PalletMovement.created_at.desc())
            .limit(limit)
            .all()
        )


class RiceBatchRepository(BaseRepository[RiceBatch]):
    model = RiceBatch

    def list_for_company(self, company_id: uuid.UUID) -> list[RiceBatch]:
        return self.db.query(RiceBatch).filter(RiceBatch.company_id == company_id).all()

    def batches_with_pallets(
        self, company_id: uuid.UUID, *, layout_ids: Sequence[uuid.UUID] | None = None
    ) -> list[tuple[RiceBatch, Pallet]]:
        q = (
            self.db.query(RiceBatch, Pallet)
            .join(Pallet, Pallet.id == RiceBatch.pallet_id)
            .filter(RiceBatch.company_id == company_id)
        )
        if layout_ids:
            q = q.filter(Pallet.layout_id.in_(layout_ids))
        return q.all()  # type: ignore[return-value]

    def varieties_in_stock(self, company_id: uuid.UUID) -> list[RiceVariety]:
        return (
            self.db.query(RiceVariety)
            .join(RiceBatch, RiceBatch.variety_id == RiceVariety.id)
            .filter(RiceBatch.company_id == company_id)
            .distinct()
            .order_by(RiceVariety.code)
            .all()
        )
