"""Repository for the employees domain (Phase 3e)."""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import Integer, cast, func, select

from ..models.employee import Employee
from ..services.doc_numbers import employee_pattern
from .base import BaseRepository


class EmployeeRepository(BaseRepository[Employee]):
    model = Employee

    def list_for_company(
        self, company_id: uuid.UUID, *, include_inactive: bool = True, branch_id: uuid.UUID | None = None
    ) -> Sequence[Employee]:
        stmt = select(Employee).where(Employee.company_id == company_id)
        if not include_inactive:
            stmt = stmt.where(Employee.is_active.is_(True))
        if branch_id:
            stmt = stmt.where(Employee.branch_id == branch_id)
        stmt = stmt.order_by(Employee.is_active.desc(), Employee.last_name, Employee.first_name)
        return self.db.execute(stmt).scalars().all()

    def next_employee_no(self, company_id: uuid.UUID, prefix: str, *, lock: bool = False) -> str:
        """REG-0001, REG-0002, ...: the prefix, then one more than the mill's
        highest number with it so far, so a number is never handed out twice,
        even after an employee is made inactive.

        ``lock`` makes two people adding employees at the same moment take turns:
        it holds a lock on this mill and prefix until the caller's transaction
        ends, so the second one sees the first's number.
        """
        if lock:
            self.db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"employee_no:{company_id}:{prefix}"))))
        top = self.db.execute(
            select(func.max(cast(func.substr(Employee.employee_no, len(prefix) + 2), Integer))).where(
                Employee.company_id == company_id,
                Employee.employee_no.op("~")(employee_pattern(prefix)),
            )
        ).scalar()
        return f"{prefix}-{int(top or 0) + 1:04d}"
