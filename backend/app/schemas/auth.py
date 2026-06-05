"""Pydantic request/response schemas for the auth domain (Phase 3). Moved verbatim."""
from pydantic import BaseModel, EmailStr


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


class GoogleAuthRequest(BaseModel):
    credential: str
    company_name: str | None = None
    is_multi_branch: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
