"""Pydantic request/response schemas for the auth domain (Phase 3)."""
from pydantic import BaseModel, EmailStr, Field


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    # Optional: the web client omits it (its refresh token lives in an httpOnly
    # cookie); bearer clients (the desktop app) still send it in the body.
    refresh_token: str | None = None


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


# ── MFA (TOTP) ───────────────────────────────────────────────────────────────

class MfaChallengeResponse(BaseModel):
    """Returned by /login instead of tokens when the account has MFA enabled."""
    mfa_required: bool = True
    challenge_token: str


class MfaVerifyRequest(BaseModel):
    challenge_token: str
    code: str = Field(min_length=6, max_length=8)


class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class MfaEnrollResponse(BaseModel):
    secret: str
    otpauth_uri: str


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
