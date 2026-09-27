"""Spatial warehouse canva — thin HTTP controllers (Phase 4.5).

Handlers only declare the HTTP shape, enforce the auth/feature/role gates via
FastAPI dependencies, and delegate to the canva services. All business logic, DB
access, geometry, transactions, and realtime broadcasts live in the
service/repository layers:

* CanvaLayoutService   — canva read + bootstrap, zone CRUD, layout lifecycle.
* PalletService        — move / resize / stack / unstack + movement audit.
* CanvaDispatchService — FIFO dispatch recommender + variety options.
* AgingReportService   — aging heatmap + rack/grid view.

The realtime WebSocket lives in ``api/canva_ws.py``; its ``ws_router`` is
re-exported here so ``main.py`` keeps registering ``canva.ws_router`` unchanged.
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles, require_section_access
from ..repositories.canva import (
    PalletMovementRepository,
    PalletRepository,
    RiceBatchRepository,
    WarehouseLayoutRepository,
    WarehouseZoneRepository,
)
from ..schemas.canva import (
    DispatchRecommendRequest,
    LayoutBulkDelete,
    LayoutCreate,
    LayoutPatch,
    PalletMove,
    PalletResize,
    PalletStack,
    PalletUnstack,
    ZoneCreate,
    ZonePatch,
)
from ..services.canva_aging_service import AgingReportService
from ..services.canva_dispatch_service import CanvaDispatchService
from ..services.canva_layout_service import CanvaLayoutService
from ..services.canva_pallet_service import PalletService
from .canva_ws import ws_router  # noqa: F401 — re-exported for main.py registration

# Roles allowed to mutate spatial state (move/stack/unstack)
WRITE_ROLES = ("owner", "admin", "mill_operator")

router = APIRouter(
    dependencies=[
        Depends(require_feature("inventory")),
        Depends(require_feature("canva_inventory")),
        Depends(require_section_access("inventory")),
    ]
)


# ── DI factories ─────────────────────────────────────────────────────────────


def get_layout_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> CanvaLayoutService:
    return CanvaLayoutService(
        db,
        current_user,
        layouts=WarehouseLayoutRepository(db),
        zones=WarehouseZoneRepository(db),
        pallets=PalletRepository(db),
        batches=RiceBatchRepository(db),
    )


def get_pallet_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PalletService:
    return PalletService(
        db,
        current_user,
        pallets=PalletRepository(db),
        layouts=WarehouseLayoutRepository(db),
        zones=WarehouseZoneRepository(db),
        movements=PalletMovementRepository(db),
    )


def get_dispatch_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> CanvaDispatchService:
    return CanvaDispatchService(
        db,
        current_user,
        pallets=PalletRepository(db),
        layouts=WarehouseLayoutRepository(db),
        batches=RiceBatchRepository(db),
    )


def get_aging_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> AgingReportService:
    return AgingReportService(
        db,
        current_user,
        layouts=WarehouseLayoutRepository(db),
        zones=WarehouseZoneRepository(db),
        pallets=PalletRepository(db),
        batches=RiceBatchRepository(db),
    )


# ── Canva read ───────────────────────────────────────────────────────────────


@router.get("/warehouses/{branch_id}/canva")
def get_warehouse_canva(
    branch_id: uuid.UUID,
    layout_id: uuid.UUID | None = None,
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.get_canva(branch_id, layout_id)


# ── Spatial mutations (move / resize / stack / unstack) ──────────────────────


@router.patch("/pallets/{pallet_id}/move")
def move_pallet(
    pallet_id: uuid.UUID,
    body: PalletMove,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: PalletService = Depends(get_pallet_service),
):
    return svc.move(pallet_id, body)


@router.patch("/pallets/{pallet_id}/resize")
def resize_pallet(
    pallet_id: uuid.UUID,
    body: PalletResize,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: PalletService = Depends(get_pallet_service),
):
    return svc.resize(pallet_id, body)


@router.patch("/pallets/{pallet_id}/stack")
def stack_pallet(
    pallet_id: uuid.UUID,
    body: PalletStack,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: PalletService = Depends(get_pallet_service),
):
    return svc.stack(pallet_id, body)


@router.patch("/pallets/{pallet_id}/unstack")
def unstack_pallet(
    pallet_id: uuid.UUID,
    body: PalletUnstack,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: PalletService = Depends(get_pallet_service),
):
    return svc.unstack(pallet_id, body)


@router.get("/pallets/{pallet_id}/movements")
def list_movements(
    pallet_id: uuid.UUID,
    svc: PalletService = Depends(get_pallet_service),
):
    return svc.list_movements(pallet_id)


# ── FIFO dispatch recommender ────────────────────────────────────────────────


@router.post("/dispatch/recommend")
def recommend_fifo(
    body: DispatchRecommendRequest,
    svc: CanvaDispatchService = Depends(get_dispatch_service),
):
    return svc.recommend_fifo(body)


@router.get("/dispatch/variety-options")
def dispatch_variety_options(
    svc: CanvaDispatchService = Depends(get_dispatch_service),
):
    return svc.variety_options()


# ── Aging report + rack/grid view ────────────────────────────────────────────


@router.get("/warehouses/{branch_id}/aging-report")
def aging_report(
    branch_id: uuid.UUID,
    svc: AgingReportService = Depends(get_aging_service),
):
    return svc.aging_report(branch_id)


@router.get("/warehouses/{branch_id}/rack-view")
def get_rack_view(
    branch_id: uuid.UUID,
    layout_id: uuid.UUID | None = None,
    svc: AgingReportService = Depends(get_aging_service),
):
    return svc.rack_view(branch_id, layout_id)


# ── Warehouse builder: zone-types, layout patch, zone CRUD ───────────────────


@router.get("/canva/zone-types")
def list_zone_types(
    _user=Depends(get_current_user),
):
    return CanvaLayoutService.zone_types()


@router.patch("/warehouses/{branch_id}/layout")
def patch_layout(
    branch_id: uuid.UUID,
    body: LayoutPatch,
    layout_id: uuid.UUID | None = None,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.patch_layout(branch_id, body, layout_id)


@router.post("/warehouses/{branch_id}/zones", status_code=201)
def create_zone(
    branch_id: uuid.UUID,
    body: ZoneCreate,
    layout_id: uuid.UUID | None = None,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.create_zone(branch_id, body, layout_id)


@router.patch("/zones/{zone_id}")
def patch_zone(
    zone_id: uuid.UUID,
    body: ZonePatch,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.patch_zone(zone_id, body)


@router.delete("/zones/{zone_id}")
def delete_zone(
    zone_id: uuid.UUID,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.delete_zone(zone_id)


# ── Customer-specific stock ──────────────────────────────────────────────────


@router.get("/canva/customers")
def list_canva_customers(
    branch_id: uuid.UUID | None = None,
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.list_canva_customers(branch_id)


# ── Multi-layout management ──────────────────────────────────────────────────


@router.get("/branches/{branch_id}/layouts/trash")
def list_trashed_layouts(
    branch_id: uuid.UUID,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.list_trashed_layouts(branch_id)


@router.post("/layouts/{layout_id}/restore")
def restore_layout(
    layout_id: uuid.UUID,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.restore_layout(layout_id)


@router.get("/branches/{branch_id}/layouts")
def list_branch_layouts(
    branch_id: uuid.UUID,
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.list_branch_layouts(branch_id)


@router.get("/warehouse-size-presets")
def list_warehouse_size_presets(
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.warehouse_size_presets()


@router.post("/branches/{branch_id}/layouts", status_code=201)
def create_branch_layout(
    branch_id: uuid.UUID,
    body: LayoutCreate,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.create_branch_layout(branch_id, body)


@router.patch("/layouts/{layout_id}/set-default")
def set_default_layout(
    layout_id: uuid.UUID,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.set_default_layout(layout_id)


@router.delete("/layouts/{layout_id}", status_code=204)
def delete_layout(
    layout_id: uuid.UUID,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    svc.delete_layout(layout_id)


@router.post("/layouts/bulk-delete")
def bulk_delete_layouts(
    body: LayoutBulkDelete,
    _=Depends(require_roles(*WRITE_ROLES)),
    svc: CanvaLayoutService = Depends(get_layout_service),
):
    return svc.bulk_delete_layouts(body)
