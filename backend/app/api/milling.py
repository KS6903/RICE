"""Milling domain HTTP controllers — thin routing over MillingService (Phase 3c)."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..repositories.inventory import (
    ByproductInventoryRepository,
    MilledRiceInventoryRepository,
)
from ..repositories.milling import MillingBatchRepository, MillingEquipmentRepository
from ..repositories.paddy import PalayInventoryRepository
from ..schemas.milling import BatchCreate, BatchOutputIn, EquipmentCreate, EquipmentUpdate
from ..services.milling_service import MillingService

router = APIRouter(dependencies=[
    Depends(require_feature("milling")),
    Depends(require_section_access("milling")),
])


def get_milling_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> MillingService:
    return MillingService(
        db,
        current_user,
        equipment=MillingEquipmentRepository(db),
        batches=MillingBatchRepository(db),
        milled=MilledRiceInventoryRepository(db),
        byproducts=ByproductInventoryRepository(db),
        palay=PalayInventoryRepository(db),
    )


# ── Equipment ─────────────────────────────────────────────────────────────────

@router.get("/equipment")
def list_equipment(include_inactive: bool = False, svc: MillingService = Depends(get_milling_service)):
    return svc.list_equipment(include_inactive=include_inactive)


@router.post(
    "/equipment",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("milling", write=True))],
)
def create_equipment(body: EquipmentCreate, svc: MillingService = Depends(get_milling_service)):
    return svc.create_equipment(body)


@router.put(
    "/equipment/{equipment_id}",
    dependencies=[Depends(require_section_access("milling", write=True))],
)
def update_equipment(equipment_id: uuid.UUID, body: EquipmentUpdate, svc: MillingService = Depends(get_milling_service)):
    return svc.update_equipment(equipment_id, body)


# ── Batches ───────────────────────────────────────────────────────────────────

@router.get("/batches")
def list_batches(skip: int = 0, limit: int = 50, svc: MillingService = Depends(get_milling_service)):
    return svc.list_batches(skip=skip, limit=limit)


@router.get("/batches/{batch_id}")
def get_batch(batch_id: uuid.UUID, svc: MillingService = Depends(get_milling_service)):
    return svc.get_batch(batch_id)


@router.post(
    "/batches",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("milling", write=True))],
)
def create_batch(body: BatchCreate, svc: MillingService = Depends(get_milling_service)):
    return svc.create_batch(body)


@router.put(
    "/batches/{batch_id}/complete",
    dependencies=[Depends(require_section_access("milling", write=True))],
)
def complete_batch(
    batch_id: uuid.UUID,
    end_datetime: datetime,
    outputs: list[BatchOutputIn] = [],
    svc: MillingService = Depends(get_milling_service),
):
    return svc.complete_batch(batch_id, end_datetime, outputs)
