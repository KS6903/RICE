import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user, hash_password, require_roles, require_feature
from ..models.user import User, Role
from ..models.subscription import Subscription

router = APIRouter(dependencies=[Depends(require_feature("users"))])


class UserCreate(BaseModel):
    username: str
    email: str | None = None
    password: str
    full_name: str
    role_id: int
    branch_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role_id: int | None = None
    is_active: bool | None = None
    branch_id: uuid.UUID | None = None


@router.get("/")
def list_users(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(User).filter(User.company_id == current_user.company_id).all()


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, current_user=Depends(require_roles("owner", "admin")), db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    existing_count = db.query(User).filter(User.company_id == current_user.company_id).count()
    sub = db.query(Subscription).filter(Subscription.company_id == current_user.company_id).first()
    if sub and sub.plan and sub.plan.max_users is not None and existing_count >= sub.plan.max_users:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Your plan allows up to {sub.plan.max_users} users. Please upgrade to add more.",
        )

    user = User(
        company_id=current_user.company_id,
        branch_id=body.branch_id,
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        role_id=body.role_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}")
def update_user(user_id: uuid.UUID, body: UserUpdate, current_user=Depends(require_roles("owner", "admin")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user or user.company_id != current_user.company_id:
        raise HTTPException(status_code=404, detail="User not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(user, field, val)
    db.commit()
    return user
