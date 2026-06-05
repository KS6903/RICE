"""EmployeeService — business logic for the employees domain (Phase 3e).

Owns the (verbatim) employee serialization and branch-map enrichment that used
to live in the route module.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundError
from ..models.company import Branch
from ..models.employee import Employee
from ..repositories.employees import EmployeeRepository
from ..services.base import BaseService


class EmployeeService(BaseService):
    def __init__(self, db: Session, current_user: Any, *, employees: EmployeeRepository) -> None:
        super().__init__(db, current_user)
        self.employees = employees

    # ── reads ─────────────────────────────────────────────────────────────────

    def _branch_map(self) -> dict:
        rows = self.db.query(Branch).filter(Branch.company_id == self.current_user.company_id).all()
        return {
            str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch}
            for b in rows
        }

    @staticmethod
    def _serialize(e: Employee, branch_map: dict) -> dict:
        return {
            "id": str(e.id),
            "company_id": str(e.company_id) if e.company_id else None,
            "branch_id": str(e.branch_id) if e.branch_id else None,
            "branch": branch_map.get(str(e.branch_id)) if e.branch_id else None,
            "employee_no": e.employee_no,
            "first_name": e.first_name,
            "middle_name": e.middle_name,
            "last_name": e.last_name,
            "full_name": " ".join(filter(None, [e.first_name, e.middle_name, e.last_name])),
            "position": e.position,
            "department": e.department,
            "employment_type": e.employment_type,
            "date_hired": e.date_hired.isoformat() if e.date_hired else None,
            "date_terminated": e.date_terminated.isoformat() if e.date_terminated else None,
            "daily_rate": float(e.daily_rate) if e.daily_rate is not None else None,
            "monthly_salary": float(e.monthly_salary) if e.monthly_salary is not None else None,
            "phone": e.phone,
            "email": e.email,
            "address": e.address,
            "birthdate": e.birthdate.isoformat() if e.birthdate else None,
            "gender": e.gender,
            "civil_status": e.civil_status,
            "sss_no": e.sss_no,
            "philhealth_no": e.philhealth_no,
            "pagibig_no": e.pagibig_no,
            "tin": e.tin,
            "emergency_contact_name": e.emergency_contact_name,
            "emergency_contact_phone": e.emergency_contact_phone,
            "emergency_contact_relation": e.emergency_contact_relation,
            "notes": e.notes,
            "is_active": e.is_active,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }

    def list_employees(self, *, include_inactive: bool = True, branch_id: uuid.UUID | None = None) -> list[dict]:
        rows = self.employees.list_for_company(
            self.current_user.company_id, include_inactive=include_inactive, branch_id=branch_id
        )
        bmap = self._branch_map()
        return [self._serialize(e, bmap) for e in rows]

    def get_employee(self, employee_id: uuid.UUID) -> dict:
        e = self.employees.get_for_company(employee_id, self.current_user.company_id)
        if not e:
            raise NotFoundError("Employee not found")
        return self._serialize(e, self._branch_map())

    # ── writes ────────────────────────────────────────────────────────────────

    def create_employee(self, data) -> dict:
        e = Employee(
            company_id=self.current_user.company_id,
            branch_id=data.branch_id or self.current_user.branch_id,
            **{k: v for k, v in data.model_dump().items() if k != "branch_id"},
        )
        with self.transaction():
            self.employees.add(e)
        self.db.refresh(e)
        return self._serialize(e, self._branch_map())

    def update_employee(self, employee_id: uuid.UUID, data) -> dict:
        e = self.employees.get_for_company(employee_id, self.current_user.company_id)
        if not e:
            raise NotFoundError("Employee not found")
        with self.transaction():
            for field, val in data.model_dump(exclude_none=True).items():
                setattr(e, field, val)
        self.db.refresh(e)
        return self._serialize(e, self._branch_map())
