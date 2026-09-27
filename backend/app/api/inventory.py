"""Inventory domain HTTP controllers — thin routing over InventoryService (Phase 3a)."""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..repositories.inventory import (
    ByproductInventoryRepository,
    MilledRiceInventoryRepository,
)
from ..repositories.paddy import PalayInventoryRepository
from ..schemas.inventory import AdjustmentIn, StockCreate
from ..services.inventory_service import InventoryService

router = APIRouter(
    dependencies=[
        Depends(require_feature("inventory")),
        Depends(require_section_access("inventory")),
    ]
)


def get_inventory_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> InventoryService:
    return InventoryService(
        db,
        current_user,
        milled=MilledRiceInventoryRepository(db),
        byproducts=ByproductInventoryRepository(db),
        palay=PalayInventoryRepository(db),
    )


@router.get("/milled-rice")
def get_milled_rice(
    branch_id: uuid.UUID | None = Query(None),
    svc: InventoryService = Depends(get_inventory_service),
):
    return svc.get_milled_rice(branch_id=branch_id)


@router.get("/byproducts")
def get_byproducts(
    branch_id: uuid.UUID | None = Query(None),
    svc: InventoryService = Depends(get_inventory_service),
):
    return svc.get_byproducts(branch_id=branch_id)


@router.get("/summary")
def inventory_summary(
    branch_id: uuid.UUID | None = Query(None),
    svc: InventoryService = Depends(get_inventory_service),
):
    return svc.get_summary(branch_id=branch_id)


@router.post(
    "/adjustments",
    dependencies=[Depends(require_section_access("inventory", write=True))],
)
def adjust_inventory(body: AdjustmentIn, svc: InventoryService = Depends(get_inventory_service)):
    return svc.adjust(body)


@router.post(
    "/stock",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("inventory", write=True))],
)
def add_stock(body: StockCreate, svc: InventoryService = Depends(get_inventory_service)):
    return svc.add_stock(body)
