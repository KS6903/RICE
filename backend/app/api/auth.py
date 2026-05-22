from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import (
    verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user, hash_password
)
from ..models.user import User, Role
from ..models.company import Company, Branch
from ..models.subscription import SubscriptionPlan, Subscription
from ..services.subscription import (
    ensure_subscription,
    effective_status,
    auto_downgrade_to_free_if_expired,
)

router = APIRouter()


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class SignupRequest(BaseModel):
    company_name: str
    full_name: str
    username: str
    email: EmailStr
    password: str
    is_multi_branch: bool = False


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already taken")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    owner_role = db.query(Role).filter_by(name="owner").first()
    if not owner_role:
        raise HTTPException(status_code=500, detail="System not initialized. Run seed.py to create roles.")

    company = Company(name=body.company_name, is_multi_branch=body.is_multi_branch)
    db.add(company)
    db.flush()

    branch = Branch(company_id=company.id, name=body.company_name, is_main_branch=True)
    db.add(branch)
    db.flush()

    # Auto-assign Free plan (fail loudly if not seeded — every tenant must have a subscription)
    if ensure_subscription(db, company.id) is None:
        raise HTTPException(
            status_code=500,
            detail="System not initialized — Free plan missing. Run alembic migrations.",
        )

    user = User(
        company_id=company.id,
        branch_id=branch.id,
        username=body.username,
        email=body.email,
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        role_id=owner_role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    payload = {"sub": str(user.id), "company_id": str(user.company_id), "role": "owner"}
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    if user.company_id and user.company is not None and not user.company.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your company account has been deactivated. Please contact the platform administrator.")

    user.last_login = datetime.now(timezone.utc)
    db.commit()

    payload = {
        "sub": str(user.id),
        "company_id": str(user.company_id) if user.company_id else None,
        "role": user.role.name if user.role else None,
        "is_platform_admin": user.is_platform_admin,
    }
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest):
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    clean = {k: v for k, v in payload.items() if k not in ("exp", "type")}
    return TokenResponse(
        access_token=create_access_token(clean),
        refresh_token=create_refresh_token(clean),
    )


@router.post("/logout")
def logout(current_user=Depends(get_current_user)):
    return {"message": "Logged out successfully"}


@router.get("/me")
def me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    # Every tenant must always have a subscription row. If one is missing
    # (e.g. tenant created via direct DB seed, not signup), assign Free now.
    # Then auto-downgrade expired paid subs so the client picks up the new
    # plan/features on its next poll instead of getting locked out.
    if current_user.company_id and not current_user.is_platform_admin:
        ensure_subscription(db, current_user.company_id)
        auto_downgrade_to_free_if_expired(db, current_user.company_id)
        db.commit()

    from ..core.security import get_user_features
    features = get_user_features(current_user, db)

    plan_info = None
    if current_user.company_id and not current_user.is_platform_admin:
        sub = db.query(Subscription).filter(Subscription.company_id == current_user.company_id).first()
        if sub and sub.plan:
            plan_info = {
                "code": sub.plan.code,
                "name": sub.plan.name,
                "monthly_price": float(sub.plan.monthly_price),
                "max_users": sub.plan.max_users,
                "max_branches": sub.plan.max_branches,
                "status": effective_status(sub) or sub.status,
                "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
            }

    return {
        "id": str(current_user.id),
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role.name if current_user.role else None,
        "company_id": str(current_user.company_id) if current_user.company_id else None,
        "branch_id": str(current_user.branch_id) if current_user.branch_id else None,
        "is_platform_admin": current_user.is_platform_admin,
        "subscription": plan_info,
        "features": features,
    }


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    current_user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"message": "Password changed successfully"}


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None


@router.put("/me")
def update_me(body: UpdateProfileRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if body.full_name is not None:
        current_user.full_name = body.full_name
    if body.email is not None and body.email != current_user.email:
        if db.query(User).filter(User.email == body.email, User.id != current_user.id).first():
            raise HTTPException(status_code=409, detail="Email already in use")
        current_user.email = body.email
    db.commit()
    return {"message": "Profile updated"}
