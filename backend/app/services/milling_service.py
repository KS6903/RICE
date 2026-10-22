"""MillingService — business logic for the milling domain (Phase 3c).

Equipment CRUD, the client list for custom milling, plus the batch lifecycle: creating a batch deducts palay stock
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
from ..models.supplier_customer import Customer
from ..models.user import User
from ..repositories.inventory import (
    ByproductInventoryRepository,
    MilledRiceInventoryRepository,
)
from ..repositories.milling import MillingBatchRepository, MillingEquipmentRepository
from ..repositories.paddy import PalayInventoryRepository
from ..repositories.sales import CustomerRepository
from ..services.base import BaseService
from ..services.canva_color import pick_unused_color


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
        customers: CustomerRepository,
    ) -> None:
        super().__init__(db, current_user)
        self.equipment = equipment
        self.batches = batches
        self.milled = milled
        self.byproducts = byproducts
        self.palay = palay
        self.customers = customers

    # ── equipment ─────────────────────────────────────────────────────────────

    def list_equipment(self, *, include_inactive: bool = False) -> Sequence[MillingEquipment]:
        return self.equipment.list_for_company(self.current_user.company_id, include_inactive=include_inactive)

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

    # ── clients (custom milling) ──────────────────────────────────────────────
    # A mill operator has no Sales access, so the batch form reads and adds
    # customers here: who the client is and how to reach them (no credit
    # limits or TINs). Inactive ones stay listed so old batches keep their
    # client's name; the form offers only the active ones.

    @staticmethod
    def _client_row(c: Customer) -> dict:
        return {"id": c.id, "name": c.name, "phone": c.phone, "address": c.address, "is_active": c.is_active}

    def list_clients(self) -> list[dict]:
        customers = self.customers.list_for_company(self.current_user.company_id, include_inactive=True)
        return [self._client_row(c) for c in customers]

    def create_client(self, data) -> dict:
        customer = Customer(
            company_id=self.current_user.company_id,
            branch_id=self.current_user.branch_id,
            canva_color_hex=pick_unused_color(self.db, self.current_user.company_id),
            customer_type="walk_in",
            name=data.name,
            phone=data.phone,
            address=(data.address or "").strip() or None,
            is_active=True,
        )
        with self.transaction():
            self.customers.add(customer)
        return self._client_row(customer)

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
        self.assert_company_fk(Customer, data.customer_id, label="Client")
        for inp in data.inputs:
            self.assert_company_fk(RiceVariety, inp.variety_id, label="Variety", allow_shared=True)
            self.assert_company_fk(QualityGrade, inp.grade_id, label="Grade", allow_shared=True)
        for out in data.outputs:
            self.assert_company_fk(RiceVariety, out.variety_id, label="Variety", allow_shared=True)
        # A client batch always says what was agreed; the mill's own has no terms.
        if data.customer_id:
            arrangement = data.client_arrangement or "client_takes_all"
            notes = (data.client_notes or "").strip() or None
        else:
            arrangement = notes = None
        with self.transaction():
            batch = self.batches.add(
                MillingBatch(
                    company_id=self.current_user.company_id,
                    branch_id=self.current_user.branch_id,
                    batch_no=self._next_batch_no(),
                    equipment_id=data.equipment_id,
                    operator_id=data.operator_id,
                    customer_id=data.customer_id,
                    client_arrangement=arrangement,
                    client_notes=notes,
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
                # A client's palay was never in the mill's stock.
                if not batch.customer_id:
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
                if self._mill_keeps(batch, out):
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
                if self._mill_keeps(b, out):
                    self._apply_output(out)
        self.db.refresh(b)
        return b

    # ── private helpers (formerly services/milling.py) ────────────────────────

    @staticmethod
    def _mill_keeps(batch: MillingBatch, out) -> bool:
        """Whether this output goes into the mill's stock. All of it does from the
        mill's own palay; from a client's, only the ipa and darak, and only when
        the mill keeps them. Contracted terms are in the notes, so stock is
        left for someone to adjust by hand."""
        if not batch.customer_id:
            return True
        return batch.client_arrangement == "mill_keeps_byproducts" and out.output_type in ("ipa", "darak")

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
                    company_id=company_id,
                    branch_id=branch_id,
                    variety_id=out.variety_id,
                    grade_name=grade_name,
                    quantity_kg=Decimal("0"),
                )
                self.db.add(inv)
                self.db.flush()
            inv.quantity_kg += out.output_weight_kg
        else:
            inv = self.byproducts.find_bucket(company_id, branch_id, out.output_type)
            if not inv:
                inv = ByproductInventory(
                    company_id=company_id,
                    branch_id=branch_id,
                    byproduct_type=out.output_type,
                    quantity_kg=Decimal("0"),
                )
                self.db.add(inv)
                self.db.flush()
            inv.quantity_kg += out.output_weight_kg
