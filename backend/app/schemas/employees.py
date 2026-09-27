"""Pydantic request schemas for the employees domain (Phase 3e). Moved verbatim."""

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class EmployeeIn(BaseModel):
    employee_no: str | None = None
    first_name: str
    middle_name: str | None = None
    last_name: str
    branch_id: uuid.UUID | None = None

    position: str | None = None
    department: str | None = None
    employment_type: str | None = None
    date_hired: date | None = None
    date_terminated: date | None = None
    daily_rate: Decimal | None = None
    monthly_salary: Decimal | None = None

    phone: str | None = None
    email: str | None = None
    address: str | None = None
    birthdate: date | None = None
    gender: str | None = None
    civil_status: str | None = None

    sss_no: str | None = None
    philhealth_no: str | None = None
    pagibig_no: str | None = None
    tin: str | None = None

    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relation: str | None = None

    notes: str | None = None


class EmployeeUpdate(BaseModel):
    employee_no: str | None = None
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    branch_id: uuid.UUID | None = None
    position: str | None = None
    department: str | None = None
    employment_type: str | None = None
    date_hired: date | None = None
    date_terminated: date | None = None
    daily_rate: Decimal | None = None
    monthly_salary: Decimal | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    birthdate: date | None = None
    gender: str | None = None
    civil_status: str | None = None
    sss_no: str | None = None
    philhealth_no: str | None = None
    pagibig_no: str | None = None
    tin: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relation: str | None = None
    notes: str | None = None
    is_active: bool | None = None
