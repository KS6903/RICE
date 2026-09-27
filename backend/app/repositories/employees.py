"""Repository for the employees domain (Phase 3e)."""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import select

from ..models.employee import Employee
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
