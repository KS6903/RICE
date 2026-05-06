import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user, require_roles, hash_password
from ..models.company import Company, Branch
from ..models.user import User, Role

router = APIRouter()


class BranchCreate(BaseModel):
    name: str
    address: str | None = None
    is_main_branch: bool = False


class BranchUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    is_active: bool | None = None


class SetupCompany(BaseModel):
    name: str
    tin: str | None = None
    nfa_license_no: str | None = None
    da_registration_no: str | None = None
    phone: str | None = None
    email: str | None = None
    is_multi_branch: bool = False


class SetupAdmin(BaseModel):
    username: str
    full_name: str
    email: str | None = None
    password: str


class SetupRequest(BaseModel):
    company: SetupCompany
    admin: SetupAdmin


@router.get("/setup-status")
def setup_status(db: Session = Depends(get_db)):
    configured = db.query(Company).first() is not None
    return {"configured": configured}


@router.post("/setup", status_code=status.HTTP_201_CREATED)
def first_run_setup(body: SetupRequest, db: Session = Depends(get_db)):
    if db.query(Company).first():
        raise HTTPException(status_code=409, detail="System already configured. Use the admin account to log in.")

    company = Company(**body.company.model_dump())
    db.add(company)
    db.flush()

    branch = Branch(company_id=company.id, name=body.company.name, is_main_branch=True)
    db.add(branch)
    db.flush()

    owner_role = db.query(Role).filter_by(name="owner").first()
    if not owner_role:
        raise HTTPException(status_code=500, detail="Roles not seeded. Run seed.py first.")

    admin_user = User(
        company_id=company.id,
        branch_id=branch.id,
        username=body.admin.username,
        full_name=body.admin.full_name,
        email=body.admin.email,
        password_hash=hash_password(body.admin.password),
        role_id=owner_role.id,
    )
    db.add(admin_user)
    db.commit()

    return {"message": "Setup complete. You can now log in.", "company_id": str(company.id)}


class CompanyUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    tin: str | None = None
    nfa_license_no: str | None = None
    da_registration_no: str | None = None
    phone: str | None = None
    email: str | None = None
    is_multi_branch: bool | None = None


@router.get("/company")
def get_company(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    company = db.get(Company, current_user.company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return {
        "id": str(company.id),
        "name": company.name,
        "address": company.address,
        "tin": company.tin,
        "nfa_license_no": company.nfa_license_no,
        "da_registration_no": company.da_registration_no,
        "phone": company.phone,
        "email": company.email,
        "currency": company.currency,
        "timezone": company.timezone,
        "is_multi_branch": company.is_multi_branch,
    }


@router.put("/company")
def update_company(body: CompanyUpdate, current_user=Depends(require_roles("owner", "admin")), db: Session = Depends(get_db)):
    company = db.get(Company, current_user.company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(company, field, val)
    db.commit()
    return {"message": "Company updated"}


@router.get("/")
def list_branches(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Branch).filter(Branch.company_id == current_user.company_id).all()


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_branch(body: BranchCreate, current_user=Depends(require_roles("owner", "admin")), db: Session = Depends(get_db)):
    from ..core.security import get_user_features
    from ..models.subscription import Subscription
    existing_count = db.query(Branch).filter(Branch.company_id == current_user.company_id).count()
    features = get_user_features(current_user, db)
    if existing_count >= 1 and "multi_branch" not in features:
        raise HTTPException(status_code=402, detail="Multi-branch is not included in your current plan. Please upgrade to add more branches.")

    sub = db.query(Subscription).filter(Subscription.company_id == current_user.company_id).first()
    if sub and sub.plan and sub.plan.max_branches is not None and existing_count >= sub.plan.max_branches:
        raise HTTPException(status_code=402, detail=f"Your plan allows up to {sub.plan.max_branches} branches. Please upgrade for more.")

    branch = Branch(company_id=current_user.company_id, **body.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


@router.put("/{branch_id}")
def update_branch(branch_id: uuid.UUID, body: BranchUpdate, current_user=Depends(require_roles("owner", "admin")), db: Session = Depends(get_db)):
    branch = db.get(Branch, branch_id)
    if not branch or branch.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="Branch not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(branch, field, val)
    db.commit()
    return branch
