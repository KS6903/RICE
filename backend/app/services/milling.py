import uuid
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from ..models.milling import MillingBatch, MilledRiceInventory, ByproductInventory
from ..models.paddy import PalayInventory, PalayInventoryMovement


def generate_batch_no(db: Session) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    count = db.query(MillingBatch).count() + 1
    return f"MB-{today}-{count:04d}"


def deduct_palay_inventory(db: Session, current_user, inp, source_id: str):
    inv = db.query(PalayInventory).filter(
        PalayInventory.company_id == current_user.company_id,
        PalayInventory.branch_id == current_user.branch_id,
        PalayInventory.variety_id == inp.variety_id,
        PalayInventory.grade_id == inp.grade_id,
    ).first()
    if inv:
        inv.quantity_kg = max(Decimal("0"), inv.quantity_kg - inp.input_weight_kg)
        db.add(PalayInventoryMovement(
            inventory_id=inv.id,
            movement_type="out",
            source_type="milling_batch",
            source_id=uuid.UUID(source_id),
            quantity_kg=inp.input_weight_kg,
            balance_after_kg=inv.quantity_kg,
            created_by=current_user.id,
            created_at=datetime.now(timezone.utc),
        ))


def apply_outputs_to_inventory(db: Session, current_user, out):
    if out.output_type == "milled_rice":
        grade_name = getattr(out, "grade_name", None) or "regular"
        inv = db.query(MilledRiceInventory).filter(
            MilledRiceInventory.company_id == current_user.company_id,
            MilledRiceInventory.branch_id == current_user.branch_id,
            MilledRiceInventory.variety_id == out.variety_id,
            MilledRiceInventory.grade_name == grade_name,
        ).first()
        if not inv:
            inv = MilledRiceInventory(
                company_id=current_user.company_id,
                branch_id=current_user.branch_id,
                variety_id=out.variety_id,
                grade_name=grade_name,
                quantity_kg=Decimal("0"),
            )
            db.add(inv)
            db.flush()
        inv.quantity_kg += out.output_weight_kg
    else:
        inv = db.query(ByproductInventory).filter(
            ByproductInventory.company_id == current_user.company_id,
            ByproductInventory.branch_id == current_user.branch_id,
            ByproductInventory.byproduct_type == out.output_type,
        ).first()
        if not inv:
            inv = ByproductInventory(
                company_id=current_user.company_id,
                branch_id=current_user.branch_id,
                byproduct_type=out.output_type,
                quantity_kg=Decimal("0"),
            )
            db.add(inv)
            db.flush()
        inv.quantity_kg += out.output_weight_kg
