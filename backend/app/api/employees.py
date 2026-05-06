import uuid
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user, require_roles, require_feature
from ..models.employee import Employee
from ..models.company import Branch

# Gate the entire employees module behind the 'employees' feature
router = APIRouter(dependencies=[Depends(require_feature("employees"))])


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


def _branch_map(db: Session, company_id) -> dict:
    rows = db.query(Branch).filter(Branch.company_id == company_id).all()
    return {str(b.id): {"id": str(b.id), "name": b.name, "is_main_branch": b.is_main_branch} for b in rows}


@router.get("/")
def list_employees(
    include_inactive: bool = True,
    branch_id: uuid.UUID | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Employee).filter(Employee.company_id == current_user.company_id)
    if not include_inactive:
        q = q.filter(Employee.is_active == True)
    if branch_id:
        q = q.filter(Employee.branch_id == branch_id)
    rows = q.order_by(Employee.is_active.desc(), Employee.last_name, Employee.first_name).all()
    bmap = _branch_map(db, current_user.company_id)
    return [_serialize(e, bmap) for e in rows]


@router.get("/{employee_id}")
def get_employee(employee_id: uuid.UUID, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    e = db.get(Employee, employee_id)
    if not e or e.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _serialize(e, _branch_map(db, current_user.company_id))


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_employee(body: EmployeeIn, current_user=Depends(require_roles("owner", "admin", "accountant")), db: Session = Depends(get_db)):
    e = Employee(
        company_id=current_user.company_id,
        branch_id=body.branch_id or current_user.branch_id,
        **{k: v for k, v in body.model_dump().items() if k != "branch_id"},
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _serialize(e, _branch_map(db, current_user.company_id))


@router.put("/{employee_id}")
def update_employee(
    employee_id: uuid.UUID,
    body: EmployeeUpdate,
    current_user=Depends(require_roles("owner", "admin", "accountant")),
    db: Session = Depends(get_db),
):
    e = db.get(Employee, employee_id)
    if not e or e.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(e, field, val)
    db.commit()
    db.refresh(e)
    return _serialize(e, _branch_map(db, current_user.company_id))
