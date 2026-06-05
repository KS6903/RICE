"""Paddy domain HTTP controllers — thin routing over PaddyService (Phase 2.4).

Handlers do three things only: declare the HTTP shape, enforce auth/feature/role
gates via FastAPI dependencies, and delegate to PaddyService. All business logic,
DB access, and transaction handling live in the service/repository layers.
"""
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..repositories.paddy import (
    PalayInventoryRepository,
    PalayPurchaseRepository,
    QualityGradeRepository,
    RiceVarietyRepository,
    SupplierRepository,
)
from ..schemas.paddy import (
    GradeCreate,
    PurchaseCreate,
    SupplierCreate,
    SupplierUpdate,
    VarietyCreate,
    VarietyUpdate,
)
from ..services.paddy_service import PaddyService

router = APIRouter(dependencies=[Depends(require_feature("paddy"))])


def get_paddy_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PaddyService:
    """Per-request DI: wire the session + user + repositories into PaddyService."""
    return PaddyService(
        db,
        current_user,
        varieties=RiceVarietyRepository(db),
        grades=QualityGradeRepository(db),
        suppliers=SupplierRepository(db),
        purchases=PalayPurchaseRepository(db),
        inventory=PalayInventoryRepository(db),
    )


# ── Varieties ──────────────────────────────────────────────────────────────────

@router.get("/varieties")
def list_varieties(include_inactive: bool = False, svc: PaddyService = Depends(get_paddy_service)):
    return svc.list_varieties(include_inactive=include_inactive)


@router.post("/varieties", status_code=status.HTTP_201_CREATED)
def create_variety(body: VarietyCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_variety(body)


@router.put("/varieties/{variety_id}")
def update_variety(variety_id: uuid.UUID, body: VarietyUpdate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.update_variety(variety_id, body)


# ── Grades ────────────────────────────────────────────────────────────────────

@router.get("/grades")
def list_grades(svc: PaddyService = Depends(get_paddy_service)):
    return svc.list_grades()


@router.post(
    "/grades",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("owner", "admin"))],
)
def create_grade(body: GradeCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_grade(body)


# ── Suppliers ─────────────────────────────────────────────────────────────────

@router.get("/suppliers")
def list_suppliers(include_inactive: bool = False, svc: PaddyService = Depends(get_paddy_service)):
    return svc.list_suppliers(include_inactive=include_inactive)


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
def create_supplier(body: SupplierCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_supplier(body)


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: uuid.UUID, body: SupplierUpdate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.update_supplier(supplier_id, body)


# ── Purchases ─────────────────────────────────────────────────────────────────

@router.get("/purchases")
def list_purchases(
    skip: int = 0,
    limit: int = 50,
    status: str | None = Query(None),
    svc: PaddyService = Depends(get_paddy_service),
):
    return svc.list_purchases(skip=skip, limit=limit, status=status)


@router.get("/purchases/{purchase_id}")
def get_purchase(purchase_id: uuid.UUID, svc: PaddyService = Depends(get_paddy_service)):
    return svc.get_purchase(purchase_id)


@router.post("/purchases", status_code=status.HTTP_201_CREATED)
def create_purchase(body: PurchaseCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_purchase(body)


@router.put("/purchases/{purchase_id}")
def update_purchase(purchase_id: uuid.UUID, body: dict, svc: PaddyService = Depends(get_paddy_service)):
    return svc.update_purchase(purchase_id, body)


# ── Inventory ─────────────────────────────────────────────────────────────────

@router.get("/inventory")
def get_palay_inventory(
    branch_id: uuid.UUID | None = Query(None),
    svc: PaddyService = Depends(get_paddy_service),
):
    return svc.get_palay_inventory(branch_id=branch_id)
