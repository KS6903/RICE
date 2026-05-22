import uuid
from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user, require_feature
from ..models.milling import MillingBatch, MillingBatchInput, MillingBatchOutput, MillingEquipment, MilledRiceInventory, ByproductInventory

router = APIRouter(dependencies=[Depends(require_feature("milling"))])


class BatchInputIn(BaseModel):
    variety_id: uuid.UUID | None = None
    grade_id: uuid.UUID | None = None
    input_weight_kg: Decimal
    moisture_content_pct: Decimal | None = None


class BatchOutputIn(BaseModel):
    output_type: str  # milled_rice, ipa, darak, binlid
    variety_id: uuid.UUID | None = None
    output_weight_kg: Decimal
    broken_rice_pct: Decimal | None = None
    grade_name: str | None = None


class BatchCreate(BaseModel):
    equipment_id: uuid.UUID | None = None
    operator_id: uuid.UUID | None = None
    start_datetime: datetime
    remarks: str | None = None
    inputs: list[BatchInputIn]
    outputs: list[BatchOutputIn] = []


class EquipmentCreate(BaseModel):
    name: str
    model: str | None = None
    capacity_kg_per_hr: Decimal | None = None


class EquipmentUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    capacity_kg_per_hr: Decimal | None = None
    is_active: bool | None = None


@router.get("/equipment")
def list_equipment(
    include_inactive: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(MillingEquipment).filter(MillingEquipment.company_id == current_user.company_id)
    if not include_inactive:
        q = q.filter(MillingEquipment.is_active == True)
    return q.order_by(MillingEquipment.name).all()


@router.post("/equipment", status_code=status.HTTP_201_CREATED)
def create_equipment(body: EquipmentCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    eq = MillingEquipment(
        company_id=current_user.company_id,
        branch_id=current_user.branch_id,
        **body.model_dump(),
    )
    db.add(eq)
    db.commit()
    db.refresh(eq)
    return eq


@router.put("/equipment/{equipment_id}")
def update_equipment(equipment_id: uuid.UUID, body: EquipmentUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    eq = db.get(MillingEquipment, equipment_id)
    if not eq or eq.company_id != current_user.company_id:
        raise HTTPException(404, "Equipment not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(eq, field, val)
    db.commit()
    db.refresh(eq)
    return eq


@router.get("/batches")
def list_batches(skip: int = 0, limit: int = 50, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(MillingBatch).filter(
        MillingBatch.company_id == current_user.company_id
    ).order_by(MillingBatch.start_datetime.desc()).offset(skip).limit(limit).all()


@router.get("/batches/{batch_id}")
def get_batch(batch_id: uuid.UUID, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    b = db.get(MillingBatch, batch_id)
    if not b or b.company_id != current_user.company_id:
        raise HTTPException(404, "Batch not found")
    return b


@router.post("/batches", status_code=status.HTTP_201_CREATED)
def create_batch(body: BatchCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    from ..services.milling import generate_batch_no, apply_outputs_to_inventory, deduct_palay_inventory
    batch_no = generate_batch_no(db)
    batch = MillingBatch(
        company_id=current_user.company_id,
        branch_id=current_user.branch_id,
        batch_no=batch_no,
        equipment_id=body.equipment_id,
        operator_id=body.operator_id,
        start_datetime=body.start_datetime,
        remarks=body.remarks,
        status="in_progress",
        created_by=current_user.id,
    )
    db.add(batch)
    db.flush()

    total_input_kg = Decimal("0")
    for inp in body.inputs:
        bi = MillingBatchInput(batch_id=batch.id, **inp.model_dump())
        db.add(bi)
        total_input_kg += inp.input_weight_kg
        deduct_palay_inventory(db, current_user, inp, str(batch.id))

    for out in body.outputs:
        recovery = (out.output_weight_kg / total_input_kg * 100) if total_input_kg > 0 else None
        bo = MillingBatchOutput(
            batch_id=batch.id,
            output_type=out.output_type,
            variety_id=out.variety_id,
            output_weight_kg=out.output_weight_kg,
            broken_rice_pct=out.broken_rice_pct,
            milling_recovery_pct=recovery if out.output_type == "milled_rice" else None,
        )
        db.add(bo)
        apply_outputs_to_inventory(db, current_user, out)

    db.commit()
    db.refresh(batch)
    return batch


@router.put("/batches/{batch_id}/complete")
def complete_batch(
    batch_id: uuid.UUID,
    end_datetime: datetime,
    outputs: list[BatchOutputIn] = [],
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from ..services.milling import apply_outputs_to_inventory
    b = db.get(MillingBatch, batch_id)
    if not b or b.company_id != current_user.company_id:
        raise HTTPException(404, "Batch not found")
    b.end_datetime = end_datetime
    b.status = "completed"

    total_input_kg = sum(i.input_weight_kg for i in b.inputs) or Decimal("1")
    for out in outputs:
        recovery = out.output_weight_kg / total_input_kg * 100 if out.output_type == "milled_rice" else None
        bo = MillingBatchOutput(
            batch_id=b.id,
            output_type=out.output_type,
            variety_id=out.variety_id,
            output_weight_kg=out.output_weight_kg,
            broken_rice_pct=out.broken_rice_pct,
            milling_recovery_pct=recovery,
        )
        db.add(bo)
        apply_outputs_to_inventory(db, current_user, out)

    db.commit()
    return b
