import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy.orm import Session
from ..models.paddy import PalayInventory, PalayInventoryMovement, PalayPurchaseItem


def generate_reference_no(db: Session, company_id: uuid.UUID) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    count = db.query(PalayInventoryMovement).count() + 1
    return f"PP-{today}-{count:04d}"


def update_palay_inventory(db: Session, current_user, item: PalayPurchaseItem, direction: str, source_id: str):
    inv = db.query(PalayInventory).filter(
        PalayInventory.company_id == current_user.company_id,
        PalayInventory.branch_id == current_user.branch_id,
        PalayInventory.variety_id == item.variety_id,
        PalayInventory.grade_id == item.grade_id,
    ).first()

    qty = item.net_weight_kg if direction == "in" else -item.net_weight_kg

    if not inv:
        inv = PalayInventory(
            company_id=current_user.company_id,
            branch_id=current_user.branch_id,
            variety_id=item.variety_id,
            grade_id=item.grade_id,
            quantity_kg=max(Decimal("0"), qty),
        )
        db.add(inv)
        db.flush()
    else:
        inv.quantity_kg = max(Decimal("0"), inv.quantity_kg + qty)

    movement = PalayInventoryMovement(
        inventory_id=inv.id,
        movement_type="in" if direction == "in" else "out",
        source_type="purchase",
        source_id=uuid.UUID(source_id),
        quantity_kg=abs(qty),
        balance_after_kg=inv.quantity_kg,
        created_by=current_user.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(movement)
