import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..models.milling import MilledRiceInventory, ByproductInventory
from ..models.paddy import PalayInventory
from ..models.company import Branch

router = APIRouter(dependencies=[Depends(require_feature("inventory"))])

# Only owners/admins may add stock by hand — keeps the books trustworthy by
# matching the write tier used elsewhere (branches, users, billing).
MANAGE_ROLES = ("owner", "admin")


class AdjustmentIn(BaseModel):
    inventory_type: str  # palay, milled_rice, byproduct
    inventory_id: uuid.UUID
    quantity_kg: Decimal
    notes: str | None = None


class StockCreate(BaseModel):
    inventory_type: str  # palay, milled_rice, byproduct
    quantity_kg: Decimal
    branch_id: uuid.UUID | None = None
    variety_id: uuid.UUID | None = None      # palay + milled_rice
    grade_id: uuid.UUID | None = None        # palay
    grade_name: str | None = None            # milled_rice
    byproduct_type: str | None = None        # byproduct


def _branch_map(db: Session, company_id) -> dict:
    rows = db.query(Branch).filter(Branch.company_id == company_id).all()
    return {str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch} for b in rows}


@router.get("/milled-rice")
def get_milled_rice(
    branch_id: uuid.UUID | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(MilledRiceInventory).filter(
        MilledRiceInventory.company_id == current_user.company_id,
        MilledRiceInventory.quantity_kg > 0,
    )
    if branch_id:
        q = q.filter(MilledRiceInventory.branch_id == branch_id)
    rows = q.all()
    branches = _branch_map(db, current_user.company_id)
    return [
        {
            "id": str(r.id),
            "branch_id": str(r.branch_id) if r.branch_id else None,
            "branch": branches.get(str(r.branch_id)) if r.branch_id else None,
            "variety_id": str(r.variety_id) if r.variety_id else None,
            "variety": {"id": str(r.variety.id), "code": r.variety.code, "name": r.variety.name} if r.variety else None,
            "grade_name": r.grade_name,
            "quantity_kg": float(r.quantity_kg),
        }
        for r in rows
    ]


@router.get("/byproducts")
def get_byproducts(
    branch_id: uuid.UUID | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(ByproductInventory).filter(ByproductInventory.company_id == current_user.company_id)
    if branch_id:
        q = q.filter(ByproductInventory.branch_id == branch_id)
    rows = q.all()
    branches = _branch_map(db, current_user.company_id)
    return [
        {
            "id": str(r.id),
            "branch_id": str(r.branch_id) if r.branch_id else None,
            "branch": branches.get(str(r.branch_id)) if r.branch_id else None,
            "byproduct_type": r.byproduct_type,
            "quantity_kg": float(r.quantity_kg),
        }
        for r in rows
    ]


@router.get("/summary")
def inventory_summary(
    branch_id: uuid.UUID | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    palay_q = db.query(PalayInventory).filter(PalayInventory.company_id == current_user.company_id)
    milled_q = db.query(MilledRiceInventory).filter(MilledRiceInventory.company_id == current_user.company_id)
    byp_q = db.query(ByproductInventory).filter(ByproductInventory.company_id == current_user.company_id)
    if branch_id:
        palay_q = palay_q.filter(PalayInventory.branch_id == branch_id)
        milled_q = milled_q.filter(MilledRiceInventory.branch_id == branch_id)
        byp_q = byp_q.filter(ByproductInventory.branch_id == branch_id)

    palay = palay_q.all()
    milled = milled_q.all()
    byproducts = byp_q.all()

    branches = _branch_map(db, current_user.company_id)
    by_branch: dict[str, dict] = {}
    for r in palay:
        bid = str(r.branch_id) if r.branch_id else "_unassigned"
        b = by_branch.setdefault(bid, {"branch": branches.get(bid), "palay_kg": 0.0, "milled_kg": 0.0, "byproduct_kg": 0.0})
        b["palay_kg"] += float(r.quantity_kg)
    for r in milled:
        bid = str(r.branch_id) if r.branch_id else "_unassigned"
        b = by_branch.setdefault(bid, {"branch": branches.get(bid), "palay_kg": 0.0, "milled_kg": 0.0, "byproduct_kg": 0.0})
        b["milled_kg"] += float(r.quantity_kg)
    for r in byproducts:
        bid = str(r.branch_id) if r.branch_id else "_unassigned"
        b = by_branch.setdefault(bid, {"branch": branches.get(bid), "palay_kg": 0.0, "milled_kg": 0.0, "byproduct_kg": 0.0})
        b["byproduct_kg"] += float(r.quantity_kg)

    return {
        "palay_total_kg": sum(float(i.quantity_kg) for i in palay),
        "milled_rice_total_kg": sum(float(i.quantity_kg) for i in milled),
        "byproducts": {b.byproduct_type: float(b.quantity_kg) for b in byproducts},
        "by_branch": list(by_branch.values()),
    }


@router.post("/adjustments")
def adjust_inventory(body: AdjustmentIn, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if body.inventory_type == "palay":
        inv = db.get(PalayInventory, body.inventory_id)
    elif body.inventory_type == "milled_rice":
        inv = db.get(MilledRiceInventory, body.inventory_id)
    else:
        inv = db.get(ByproductInventory, body.inventory_id)

    if inv:
        inv.quantity_kg = max(Decimal("0"), inv.quantity_kg + body.quantity_kg)
    db.commit()
    return {"adjusted": True, "new_quantity_kg": float(inv.quantity_kg) if inv else 0}


@router.post("/stock", status_code=status.HTTP_201_CREATED)
def add_stock(
    body: StockCreate,
    current_user=Depends(require_roles(*MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Owner/admin manually adds stock to inventory.

    Upserts onto a matching row (same branch + variety/grade/type) so the
    inventory lists don't fill up with duplicate entries — repeated adds to the
    same SKU just accumulate on one row, mirroring how milling output lands.
    """
    if body.quantity_kg is None or body.quantity_kg <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be greater than zero.")

    if body.branch_id:
        branch = db.get(Branch, body.branch_id)
        if not branch or branch.company_id != current_user.company_id:
            raise HTTPException(status_code=404, detail="Warehouse not found.")

    company_id = current_user.company_id

    if body.inventory_type == "palay":
        if not body.variety_id:
            raise HTTPException(status_code=422, detail="Variety is required for palay.")
        inv = (
            db.query(PalayInventory)
            .filter(
                PalayInventory.company_id == company_id,
                PalayInventory.branch_id == body.branch_id,
                PalayInventory.variety_id == body.variety_id,
                PalayInventory.grade_id == body.grade_id,
            )
            .first()
        )
        if not inv:
            inv = PalayInventory(
                company_id=company_id,
                branch_id=body.branch_id,
                variety_id=body.variety_id,
                grade_id=body.grade_id,
                quantity_kg=Decimal("0"),
            )
            db.add(inv)
        inv.quantity_kg = inv.quantity_kg + body.quantity_kg

    elif body.inventory_type == "milled_rice":
        if not body.variety_id:
            raise HTTPException(status_code=422, detail="Variety is required for milled rice.")
        inv = (
            db.query(MilledRiceInventory)
            .filter(
                MilledRiceInventory.company_id == company_id,
                MilledRiceInventory.branch_id == body.branch_id,
                MilledRiceInventory.variety_id == body.variety_id,
                MilledRiceInventory.grade_name == body.grade_name,
            )
            .first()
        )
        if not inv:
            inv = MilledRiceInventory(
                company_id=company_id,
                branch_id=body.branch_id,
                variety_id=body.variety_id,
                grade_name=body.grade_name,
                quantity_kg=Decimal("0"),
            )
            db.add(inv)
        inv.quantity_kg = inv.quantity_kg + body.quantity_kg

    elif body.inventory_type == "byproduct":
        # By-product type is a free-form slug so owners can introduce their own
        # named goods (and custom stock types route through here too).
        btype = (body.byproduct_type or "").strip().lower()
        if not btype:
            raise HTTPException(status_code=422, detail="By-product type is required.")
        body.byproduct_type = btype
        inv = (
            db.query(ByproductInventory)
            .filter(
                ByproductInventory.company_id == company_id,
                ByproductInventory.branch_id == body.branch_id,
                ByproductInventory.byproduct_type == body.byproduct_type,
            )
            .first()
        )
        if not inv:
            inv = ByproductInventory(
                company_id=company_id,
                branch_id=body.branch_id,
                byproduct_type=body.byproduct_type,
                quantity_kg=Decimal("0"),
            )
            db.add(inv)
        inv.quantity_kg = inv.quantity_kg + body.quantity_kg

    else:
        raise HTTPException(
            status_code=422,
            detail="inventory_type must be one of: palay, milled_rice, byproduct.",
        )

    db.commit()
    db.refresh(inv)
    return {
        "id": str(inv.id),
        "inventory_type": body.inventory_type,
        "quantity_kg": float(inv.quantity_kg),
    }
