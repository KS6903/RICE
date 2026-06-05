"""Auth domain HTTP controllers — thin routing over AuthService (Phase 3).

Unauthenticated endpoints (signup/login/refresh/google) use a service with no
current_user; the account self-service endpoints (me/change-password/profile)
inject the authenticated user.
"""
from fastapi import APIRouter, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user
from ..schemas.auth import (
    ChangePasswordRequest,
    GoogleAuthRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
    UpdateProfileRequest,
)
from ..services.auth_service import AuthService

router = APIRouter()


def get_public_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db)


def get_auth_service(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> AuthService:
    return AuthService(db, current_user)


# ── Unauthenticated ──────────────────────────────────────────────────────────

@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, svc: AuthService = Depends(get_public_auth_service)):
    return svc.signup(body)


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), svc: AuthService = Depends(get_public_auth_service)):
    return svc.login(form.username, form.password)


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, svc: AuthService = Depends(get_public_auth_service)):
    return svc.refresh(body.refresh_token)


@router.post("/google", response_model=TokenResponse)
def google_auth(body: GoogleAuthRequest, svc: AuthService = Depends(get_public_auth_service)):
    return svc.google_auth(body)


# ── Authenticated ────────────────────────────────────────────────────────────

@router.post("/logout")
def logout(current_user=Depends(get_current_user)):
    return {"message": "Logged out successfully"}


@router.get("/me")
def me(svc: AuthService = Depends(get_auth_service)):
    return svc.me()


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.change_password(body)


@router.put("/me")
def update_me(body: UpdateProfileRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.update_profile(body)
