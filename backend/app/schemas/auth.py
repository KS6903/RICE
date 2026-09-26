"""Pydantic request/response schemas for the auth domain (Phase 3)."""
from pydantic import BaseModel, EmailStr, Field


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class BrowserAuthResponse(BaseModel):
    """Cookie-auth success response; intentionally contains no bearer secret."""

    authenticated: bool = True


class RefreshRequest(BaseModel):
    # Optional: the web client omits it (its refresh token lives in an httpOnly
    # cookie); bearer clients (the desktop app) still send it in the body.
    refresh_token: str | None = Field(default=None, max_length=4096)


class SignupRequest(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    full_name: str = Field(min_length=1, max_length=150)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    is_multi_branch: bool = False
    invite_code: str | None = Field(default=None, max_length=255)
    # Click-through consent. The server re-checks this rather than trusting the
    # UI to have shown the checkbox, so an account cannot exist without a
    # matching row in legal_acceptances.
    accepted_terms: bool = False
    agreement_version: str | None = Field(default=None, max_length=32)


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)
    company_name: str | None = Field(default=None, max_length=200)
    is_multi_branch: bool = False
    invite_code: str | None = Field(default=None, max_length=255)
    # Only consulted when this call creates a new company; an existing Google
    # user signing in is gated by /legal/acceptance instead.
    accepted_terms: bool = False
    agreement_version: str | None = Field(default=None, max_length=32)


class GoogleLinkRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)
    current_password: str | None = Field(default=None, max_length=72)
    mfa_code: str | None = Field(default=None, min_length=6, max_length=8)


class GoogleUnlinkRequest(BaseModel):
    current_password: str | None = Field(default=None, max_length=72)
    mfa_code: str | None = Field(default=None, min_length=6, max_length=8)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


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
    full_name: str | None = Field(default=None, min_length=1, max_length=150)
    email: EmailStr | None = None
    # Required only when changing the email address. MFA-enabled users may
    # prove possession with a current TOTP instead of their password.
    current_password: str | None = Field(default=None, max_length=72)
    mfa_code: str | None = Field(default=None, min_length=6, max_length=8)
