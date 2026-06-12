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


# ── Password reset ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    # Either a username or an email — we never reveal which (if any) matched.
    identifier: str = Field(min_length=1, max_length=255)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=255)
    new_password: str


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=1, max_length=255)


# ── MFA (TOTP) ───────────────────────────────────────────────────────────────

class MfaChallengeResponse(BaseModel):
    """Returned by /login instead of tokens when the account has MFA enabled."""
    mfa_required: bool = True
    challenge_token: str


class MfaVerifyRequest(BaseModel):
    challenge_token: str
    # A 6-digit TOTP, or a one-time backup/recovery code (longer).
    code: str = Field(min_length=6, max_length=40)


class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class MfaEnrollResponse(BaseModel):
    secret: str
    otpauth_uri: str


class MfaBackupCodesResponse(BaseModel):
    """Returned once on enrollment / regeneration — the raw codes are never
    shown again (only their hashes are stored)."""
    backup_codes: list[str]


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
