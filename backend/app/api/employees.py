"""Employees domain HTTP controllers — thin routing over EmployeeService (Phase 3e)."""
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, require_feature, require_roles
from ..repositories.employees import EmployeeRepository
from ..schemas.employees import EmployeeIn, EmployeeUpdate
from ..services.employee_service import EmployeeService

# Gate the entire employees module behind the 'employees' feature
router = APIRouter(dependencies=[Depends(require_feature("employees"))])

WRITE_ROLES = ("owner", "admin", "accountant")


def get_employee_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> EmployeeService:
    return EmployeeService(db, current_user, employees=EmployeeRepository(db))


@router.get("/")
def list_employees(
    include_inactive: bool = True,
    branch_id: uuid.UUID | None = Query(None),
    svc: EmployeeService = Depends(get_employee_service),
):
    return svc.list_employees(include_inactive=include_inactive, branch_id=branch_id)


@router.get("/{employee_id}")
def get_employee(employee_id: uuid.UUID, svc: EmployeeService = Depends(get_employee_service)):
    return svc.get_employee(employee_id)


@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_roles(*WRITE_ROLES))])
def create_employee(body: EmployeeIn, svc: EmployeeService = Depends(get_employee_service)):
    return svc.create_employee(body)


@router.put("/{employee_id}", dependencies=[Depends(require_roles(*WRITE_ROLES))])
def update_employee(employee_id: uuid.UUID, body: EmployeeUpdate, svc: EmployeeService = Depends(get_employee_service)):
    return svc.update_employee(employee_id, body)
