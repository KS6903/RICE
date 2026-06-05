import uuid
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..models.paddy import PalayPurchase, PalayPurchaseItem, PalayInventory, PalayInventoryMovement, DryingRecord
from ..models.reference import RiceVariety, QualityGrade
from ..models.supplier_customer import Supplier
from ..services.canva_color import pick_unused_color
from datetime import datetime, timezone

router = APIRouter(dependencies=[Depends(require_feature("paddy"))])


# ── Varieties ──────────────────────────────────────────────────────────────────

@router.get("/varieties")
def list_varieties(
    include_inactive: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(RiceVariety).filter(
        (RiceVariety.company_id == current_user.company_id) | (RiceVariety.company_id.is_(None))
    )
    if not include_inactive:
        q = q.filter(RiceVariety.is_active == True)
    return q.order_by(RiceVariety.code).all()


class VarietyCreate(BaseModel):
    code: str
    name: str
    category: str | None = None
    typical_recovery_pct: Decimal | None = None


class VarietyUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    category: str | None = None
    typical_recovery_pct: Decimal | None = None
    is_active: bool | None = None


@router.post("/varieties", status_code=status.HTTP_201_CREATED)
def create_variety(body: VarietyCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(RiceVariety).filter(
        RiceVariety.company_id == current_user.company_id,
        RiceVariety.code == body.code,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Variety code '{body.code}' already exists in your company")
    variety = RiceVariety(company_id=current_user.company_id, **body.model_dump())
    db.add(variety)
    db.commit()
    db.refresh(variety)
    return variety


@router.put("/varieties/{variety_id}")
def update_variety(variety_id: uuid.UUID, body: VarietyUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    v = db.get(RiceVariety, variety_id)
    if not v:
        raise HTTPException(status_code=404, detail="Variety not found")
    if v.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Cannot edit shared/system varieties. Create your own copy instead.")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(v, field, val)
    db.commit()
    db.refresh(v)
    return v


@router.get("/grades")
def list_grades(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(QualityGrade).filter(
        (QualityGrade.company_id == current_user.company_id) | (QualityGrade.company_id.is_(None))
    ).all()


class GradeCreate(BaseModel):
    code: str
    name: str | None = None


@router.post("/grades", status_code=status.HTTP_201_CREATED)
def create_grade(body: GradeCreate, current_user=Depends(require_roles("owner", "admin")), db: Session = Depends(get_db)):
    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="Grade code is required.")
    existing = db.query(QualityGrade).filter(
        QualityGrade.company_id == current_user.company_id,
        QualityGrade.code == code,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Grade '{code}' already exists in your company.")
    grade = QualityGrade(company_id=current_user.company_id, code=code, name=(body.name or code).strip())
    db.add(grade)
    db.commit()
    db.refresh(grade)
    return grade


@router.get("/suppliers")
def list_suppliers(
    include_inactive: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Supplier).filter(Supplier.company_id == current_user.company_id)
    if not include_inactive:
        q = q.filter(Supplier.is_active == True)
    return q.order_by(Supplier.name).all()


class SupplierCreate(BaseModel):
    supplier_type: str | None = None
    name: str
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    municipality: str | None = None
    province: str | None = None
    farmer_id: str | None = None


class SupplierUpdate(BaseModel):
    supplier_type: str | None = None
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    municipality: str | None = None
    province: str | None = None
    farmer_id: str | None = None
    is_active: bool | None = None


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
def create_supplier(body: SupplierCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    # System-generated canva color from the shared per-tenant pool — never
    # accepted from the client.
    color = pick_unused_color(db, current_user.company_id)
    supplier = Supplier(
        company_id=current_user.company_id,
        branch_id=current_user.branch_id,
        canva_color_hex=color,
        **body.model_dump()
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: uuid.UUID, body: SupplierUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    s = db.get(Supplier, supplier_id)
    if not s or s.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Supplier not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(s, field, val)
    db.commit()
    db.refresh(s)
    return s


# ── Purchases ─────────────────────────────────────────────────────────────────

class PurchaseItemIn(BaseModel):
    variety_id: uuid.UUID | None = None
    grade_id: uuid.UUID | None = None
    gross_weight_kg: Decimal
    tare_weight_kg: Decimal = Decimal("0")
    moisture_content_pct: Decimal | None = None
    price_per_cavan: Decimal


class PurchaseCreate(BaseModel):
    supplier_id: uuid.UUID
    purchase_date: date
    delivery_type: str | None = None
    remarks: str | None = None
    items: list[PurchaseItemIn]


@router.get("/purchases")
def list_purchases(
    skip: int = 0,
    limit: int = 50,
    status: str | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    q = db.query(PalayPurchase).filter(PalayPurchase.company_id == current_user.company_id)
    if status:
        q = q.filter(PalayPurchase.status == status)
    return q.order_by(PalayPurchase.purchase_date.desc()).offset(skip).limit(limit).all()


@router.get("/purchases/{purchase_id}")
def get_purchase(purchase_id: uuid.UUID, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(PalayPurchase, purchase_id)
    if not p or p.company_id != current_user.company_id:
        raise HTTPException(404, "Purchase not found")
    return p


@router.post("/purchases", status_code=status.HTTP_201_CREATED)
def create_purchase(body: PurchaseCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    from ..services.paddy import generate_reference_no, update_palay_inventory
    ref_no = generate_reference_no(db, current_user.company_id)
    purchase = PalayPurchase(
        company_id=current_user.company_id,
        branch_id=current_user.branch_id,
        reference_no=ref_no,
        supplier_id=body.supplier_id,
        purchase_date=body.purchase_date,
        delivery_type=body.delivery_type,
        remarks=body.remarks,
        status="received",
        created_by=current_user.id,
    )
    db.add(purchase)
    db.flush()

    for item_data in body.items:
        item = PalayPurchaseItem(purchase_id=purchase.id, **item_data.model_dump())
        item.cavan_count = (item.gross_weight_kg - item.tare_weight_kg) / 50
        db.add(item)
        db.flush()
        update_palay_inventory(db, current_user, item, "in", str(purchase.id))

    db.commit()
    db.refresh(purchase)
    return purchase


@router.put("/purchases/{purchase_id}")
def update_purchase(purchase_id: uuid.UUID, body: dict, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(PalayPurchase, purchase_id)
    if not p or p.company_id != current_user.company_id:
        raise HTTPException(404, "Purchase not found")
    for field in ("status", "remarks", "delivery_type"):
        if field in body:
            setattr(p, field, body[field])
    db.commit()
    return p


# ── Inventory ─────────────────────────────────────────────────────────────────

@router.get("/inventory")
def get_palay_inventory(
    branch_id: uuid.UUID | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..models.company import Branch
    q = db.query(PalayInventory).filter(
        PalayInventory.company_id == current_user.company_id,
        PalayInventory.quantity_kg > 0,
    )
    if branch_id:
        q = q.filter(PalayInventory.branch_id == branch_id)
    rows = q.all()
    branch_rows = db.query(Branch).filter(Branch.company_id == current_user.company_id).all()
    bmap = {str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch} for b in branch_rows}
    return [
        {
            "id": str(r.id),
            "branch_id": str(r.branch_id) if r.branch_id else None,
            "branch": bmap.get(str(r.branch_id)) if r.branch_id else None,
            "variety": {"id": str(r.variety.id), "code": r.variety.code, "name": r.variety.name} if r.variety else None,
            "grade": {"id": str(r.grade.id), "code": r.grade.code} if r.grade else None,
            "quantity_kg": float(r.quantity_kg),
        }
        for r in rows
    ]
