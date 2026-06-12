"""MillingService — business logic for the milling domain (Phase 3c).

Equipment CRUD plus the batch lifecycle: creating a batch deducts palay stock
per input and rolls each output into milled-rice / by-product inventory, with the
milling-recovery percentage computed against total input. The old module helpers
(generate_batch_no, deduct_palay_inventory, apply_outputs_to_inventory) are folded
in as private methods. The service owns the transaction; repositories flush only.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError
from ..models.milling import (
    ByproductInventory,
    MilledRiceInventory,
    MillingBatch,
    MillingBatchInput,
    MillingBatchOutput,
    MillingEquipment,
)
from ..models.paddy import PalayInventoryMovement
from ..models.reference import QualityGrade, RiceVariety
from ..models.user import User
from ..repositories.inventory import (
    ByproductInventoryRepository,
    MilledRiceInventoryRepository,
)
from ..repositories.milling import MillingBatchRepository, MillingEquipmentRepository
from ..repositories.paddy import PalayInventoryRepository
from ..services.base import BaseService


class MillingService(BaseService):
    def __init__(
        self,
        db: Session,
        current_user: Any,
        *,
        equipment: MillingEquipmentRepository,
        batches: MillingBatchRepository,
        milled: MilledRiceInventoryRepository,
        byproducts: ByproductInventoryRepository,
        palay: PalayInventoryRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.equipment = equipment
        self.batches = batches
        self.milled = milled
        self.byproducts = byproducts
        self.palay = palay

    # ── equipment ─────────────────────────────────────────────────────────────

    def list_equipment(self, *, include_inactive: bool = False) -> Sequence[MillingEquipment]:
        return self.equipment.list_for_company(
            self.current_user.company_id, include_inactive=include_inactive
        )

    def create_equipment(self, data) -> MillingEquipment:
        eq = MillingEquipment(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            **data.model_dump(),
        )
        with self.transaction():
            self.equipment.add(eq)
        self.db.refresh(eq)
        return eq

    def update_equipment(self, equipment_id: uuid.UUID, data) -> MillingEquipment:
        eq = self.equipment.get_for_company(equipment_id, self.current_user.company_id)
        if not eq:
            raise NotFoundError("Equipment not found")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(eq, field, val)
        self.db.refresh(eq)
        return eq

    # ── batches ───────────────────────────────────────────────────────────────

    def list_batches(self, *, skip: int = 0, limit: int = 50) -> Sequence[MillingBatch]:
        return self.batches.list_for_company(self.current_user.company_id, skip=skip, limit=limit)

    def get_batch(self, batch_id: uuid.UUID) -> MillingBatch:
        b = self.batches.get_for_company(batch_id, self.current_user.company_id)
        if not b:
            raise NotFoundError("Batch not found")
        return b

    def create_batch(self, data) -> MillingBatch:
        # IDOR guards: equipment and operator must belong to this company;
        # varieties/grades must be ours or from the shared system catalog.
        self.assert_company_fk(MillingEquipment, data.equipment_id, label="Equipment")
        self.assert_company_fk(User, data.operator_id, label="Operator")
        for inp in data.inputs:
            self.assert_company_fk(RiceVariety, inp.variety_id, label="Variety", allow_shared=True)
            self.assert_company_fk(QualityGrade, inp.grade_id, label="Grade", allow_shared=True)
        for out in data.outputs:
            self.assert_company_fk(RiceVariety, out.variety_id, label="Variety", allow_shared=True)
        with self.transaction():
            batch = self.batches.add(
                MillingBatch(
                    company_id=self.current_user.company_id,
                    branch_id=self.current_user.branch_id,
                    batch_no=self._next_batch_no(),
                    equipment_id=data.equipment_id,
                    operator_id=data.operator_id,
                    start_datetime=data.start_datetime,
                    remarks=data.remarks,
                    status="in_progress",
                    created_by=self.current_user.id,
                )
            )
            total_input_kg = Decimal("0")
            for inp in data.inputs:
                self.db.add(MillingBatchInput(batch_id=batch.id, **inp.model_dump()))
                total_input_kg += inp.input_weight_kg
                self._deduct_palay(inp, str(batch.id))

            for out in data.outputs:
                recovery = (out.output_weight_kg / total_input_kg * 100) if total_input_kg > 0 else None
                self.db.add(
                    MillingBatchOutput(
                        batch_id=batch.id,
                        output_type=out.output_type,
                        variety_id=out.variety_id,
                        output_weight_kg=out.output_weight_kg,
                        broken_rice_pct=out.broken_rice_pct,
                        milling_recovery_pct=recovery if out.output_type == "milled_rice" else None,
                    )
                )
                self._apply_output(out)
        self.db.refresh(batch)
        return batch

    def complete_batch(self, batch_id: uuid.UUID, end_datetime: datetime, outputs) -> MillingBatch:
        b = self.batches.get_for_company(batch_id, self.current_user.company_id)
        if not b:
            raise NotFoundError("Batch not found")
        with self.transaction():
            b.end_datetime = end_datetime
            b.status = "completed"
            total_input_kg = sum((i.input_weight_kg for i in b.inputs), Decimal("0")) or Decimal("1")
            for out in outputs:
                recovery = out.output_weight_kg / total_input_kg * 100 if out.output_type == "milled_rice" else None
                self.db.add(
                    MillingBatchOutput(
                        batch_id=b.id,
                        output_type=out.output_type,
                        variety_id=out.variety_id,
                        output_weight_kg=out.output_weight_kg,
                        broken_rice_pct=out.broken_rice_pct,
                        milling_recovery_pct=recovery,
                    )
                )
                self._apply_output(out)
        self.db.refresh(b)
        return b

    # ── private helpers (formerly services/milling.py) ────────────────────────

    def _next_batch_no(self) -> str:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"MB-{today}-{self.batches.count() + 1:04d}"

    def _deduct_palay(self, inp, source_id: str) -> None:
        inv = self.palay.find_bucket(
            self.current_user.company_id, self.current_user.branch_id, inp.variety_id, inp.grade_id
        )
        if inv:
            inv.quantity_kg = max(Decimal("0"), inv.quantity_kg - inp.input_weight_kg)
            self.db.add(
                PalayInventoryMovement(
                    inventory_id=inv.id,
                    movement_type="out",
                    source_type="milling_batch",
                    source_id=uuid.UUID(source_id),
                    quantity_kg=inp.input_weight_kg,
                    balance_after_kg=inv.quantity_kg,
                    created_by=self.current_user.id,
                    created_at=datetime.now(timezone.utc),
                )
            )

    def _apply_output(self, out) -> None:
        company_id = self.current_user.company_id
        branch_id = self.current_user.branch_id
        inv: Any
        if out.output_type == "milled_rice":
            grade_name = getattr(out, "grade_name", None) or "regular"
            inv = self.milled.find_bucket(company_id, branch_id, out.variety_id, grade_name)
            if not inv:
                inv = MilledRiceInventory(
                    company_id=company_id, branch_id=branch_id,
                    variety_id=out.variety_id, grade_name=grade_name, quantity_kg=Decimal("0"),
                )
                self.db.add(inv)
                self.db.flush()
            inv.quantity_kg += out.output_weight_kg
        else:
            inv = self.byproducts.find_bucket(company_id, branch_id, out.output_type)
            if not inv:
                inv = ByproductInventory(
                    company_id=company_id, branch_id=branch_id,
                    byproduct_type=out.output_type, quantity_kg=Decimal("0"),
                )
                self.db.add(inv)
                self.db.flush()
            inv.quantity_kg += out.output_weight_kg
