"""Paddy domain HTTP controllers — thin routing over PaddyService (Phase 2.4).

Handlers do three things only: declare the HTTP shape, enforce auth/feature/role
gates via FastAPI dependencies, and delegate to PaddyService. All business logic,
DB access, and transaction handling live in the service/repository layers.
"""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_section_access
from ..repositories.inventory import ByproductInventoryRepository, MilledRiceInventoryRepository
from ..repositories.paddy import (
    PalayInventoryRepository,
    PalayPurchaseRepository,
    QualityGradeRepository,
    RiceVarietyRepository,
    SupplierRepository,
)
from ..schemas.buying import (
    ByproductPurchaseCreate,
    ByproductPurchaseEdit,
    RicePurchaseCreate,
    RicePurchaseEdit,
)
from ..schemas.paddy import (
    GradeCreate,
    PurchaseCreate,
    PurchaseEdit,
    PurchaseUpdate,
    SupplierCreate,
    SupplierUpdate,
    VarietyCreate,
    VarietyUpdate,
)
from ..services.activity_service import ActivityService
from ..services.buying_service import BuyingService
from ..services.inventory_service import InventoryService
from ..services.paddy_service import PaddyService
from ..services.record_changes import require_record_editor
from .inventory import get_inventory_service

router = APIRouter(
    dependencies=[
        Depends(require_feature("paddy")),
        Depends(require_section_access("paddy")),
    ]
)


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


@router.post(
    "/varieties",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def create_variety(body: VarietyCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_variety(body)


@router.put(
    "/varieties/{variety_id}",
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def update_variety(variety_id: uuid.UUID, body: VarietyUpdate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.update_variety(variety_id, body)


# ── Grades ────────────────────────────────────────────────────────────────────


@router.get("/grades")
def list_grades(svc: PaddyService = Depends(get_paddy_service)):
    return svc.list_grades()


@router.post(
    "/grades",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def create_grade(body: GradeCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_grade(body)


# ── Suppliers ─────────────────────────────────────────────────────────────────


@router.get("/suppliers")
def list_suppliers(include_inactive: bool = False, svc: PaddyService = Depends(get_paddy_service)):
    return svc.list_suppliers(include_inactive=include_inactive)


@router.post(
    "/suppliers",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def create_supplier(body: SupplierCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_supplier(body)


@router.put(
    "/suppliers/{supplier_id}",
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
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
    return [svc.serialize_purchase(p) for p in svc.list_purchases(skip=skip, limit=limit, status=status)]


@router.get("/purchases/{purchase_id}")
def get_purchase(purchase_id: uuid.UUID, svc: PaddyService = Depends(get_paddy_service)):
    return svc.serialize_purchase(svc.get_purchase(purchase_id))


@router.post(
    "/purchases",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def create_purchase(body: PurchaseCreate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.create_purchase(body)


@router.put(
    "/purchases/{purchase_id}",
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def update_purchase(purchase_id: uuid.UUID, body: PurchaseUpdate, svc: PaddyService = Depends(get_paddy_service)):
    return svc.update_purchase(purchase_id, body)


@router.patch("/purchases/{purchase_id}", dependencies=[Depends(require_record_editor)])
def edit_purchase(purchase_id: uuid.UUID, body: PurchaseEdit, svc: PaddyService = Depends(get_paddy_service)):
    """Correct a saved purchase (edit power), every change logged."""
    return svc.serialize_purchase(svc.edit_purchase(purchase_id, body))


# ── Inventory ─────────────────────────────────────────────────────────────────


@router.get("/inventory")
def get_palay_inventory(
    branch_id: uuid.UUID | None = Query(None),
    svc: PaddyService = Depends(get_paddy_service),
):
    return svc.get_palay_inventory(branch_id=branch_id)


# ── Rice (bigas) and by-product purchases ──────────────────────────────────────
# Bought in the same way as palay, so they sit behind the same plan feature and
# the same "paddy" (buying) section; each has its own page in the web app.


def get_buying_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> BuyingService:
    return BuyingService(
        db,
        current_user,
        milled=MilledRiceInventoryRepository(db),
        byproducts=ByproductInventoryRepository(db),
    )


@router.get("/rice-purchases")
def list_rice_purchases(skip: int = 0, limit: int = 50, svc: BuyingService = Depends(get_buying_service)):
    return svc.list_rice_purchases(skip=skip, limit=limit)


@router.post(
    "/rice-purchases",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def create_rice_purchase(body: RicePurchaseCreate, svc: BuyingService = Depends(get_buying_service)):
    return svc.create_rice_purchase(body)


@router.patch("/rice-purchases/{purchase_id}", dependencies=[Depends(require_record_editor)])
def edit_rice_purchase(
    purchase_id: uuid.UUID, body: RicePurchaseEdit, svc: BuyingService = Depends(get_buying_service)
):
    return svc.edit_rice_purchase(purchase_id, body)


@router.get("/rice-stock")
def get_rice_stock(svc: InventoryService = Depends(get_inventory_service)):
    """Milled rice on hand, for the Rice page (same rows as Inventory shows)."""
    return svc.get_milled_rice()


@router.get("/byproduct-purchases")
def list_byproduct_purchases(skip: int = 0, limit: int = 50, svc: BuyingService = Depends(get_buying_service)):
    return svc.list_byproduct_purchases(skip=skip, limit=limit)


@router.post(
    "/byproduct-purchases",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_section_access("paddy", write=True))],
)
def create_byproduct_purchase(body: ByproductPurchaseCreate, svc: BuyingService = Depends(get_buying_service)):
    return svc.create_byproduct_purchase(body)


@router.patch("/byproduct-purchases/{purchase_id}", dependencies=[Depends(require_record_editor)])
def edit_byproduct_purchase(
    purchase_id: uuid.UUID, body: ByproductPurchaseEdit, svc: BuyingService = Depends(get_buying_service)
):
    return svc.edit_byproduct_purchase(purchase_id, body)


@router.get("/history/{entity_type}/{entity_id}")
def purchase_history(
    entity_type: Literal["palay_purchase", "rice_purchase", "byproduct_purchase"],
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Every logged change to one purchase, newest first."""
    return ActivityService(db, current_user).list_for_entity(current_user.company_id, entity_type, entity_id)


@router.get("/byproduct-stock")
def get_byproduct_stock(svc: InventoryService = Depends(get_inventory_service)):
    """By-products on hand, for the By-products page (rows with stock only)."""
    return [r for r in svc.get_byproducts() if r["quantity_kg"] > 0]
