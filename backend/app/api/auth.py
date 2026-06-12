"""Auth domain HTTP controllers — thin routing over AuthService (Phase 3).

Unauthenticated endpoints (signup/login/refresh/google) use a service with no
current_user; the account self-service endpoints (me/change-password/profile)
inject the authenticated user.
"""
from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..core.cookies import ACCESS_COOKIE, REFRESH_COOKIE, clear_auth_cookies, set_auth_cookies
from ..core.csrf import enforce_csrf
from ..core.database import get_db
from ..core.exceptions import UnauthorizedError
from ..core.ratelimit import AUTH_RATE_LIMIT, limiter
from ..core.security import get_current_user
from ..schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    MfaBackupCodesResponse,
    MfaCodeRequest,
    MfaEnrollResponse,
    MfaVerifyRequest,
    RefreshRequest,
    ResetPasswordRequest,
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
@limiter.limit(AUTH_RATE_LIMIT)
def signup(
    request: Request,
    response: Response,
    body: SignupRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    tokens = svc.signup(body)
    set_auth_cookies(response, access_token=tokens.access_token, refresh_token=tokens.refresh_token)
    return tokens


@router.post("/login", response_model=None)
@limiter.limit(AUTH_RATE_LIMIT)
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    svc: AuthService = Depends(get_public_auth_service),
):
    """Returns the token pair in the body (desktop/bearer clients) AND as
    httpOnly session cookies (web client — JS never touches the tokens).

    Accounts with MFA enabled get ``{"mfa_required": true, "challenge_token"}``
    instead — the client completes login via POST /auth/mfa/verify."""
    result = svc.login(form.username, form.password)
    if isinstance(result, TokenResponse):
        set_auth_cookies(response, access_token=result.access_token, refresh_token=result.refresh_token)
    return result


@router.post("/forgot-password")
@limiter.limit(AUTH_RATE_LIMIT)
def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Request a password reset. Always responds the same way (no account
    enumeration); the reset link is delivered out-of-band."""
    return svc.request_password_reset(body.identifier)


@router.post("/reset-password")
@limiter.limit(AUTH_RATE_LIMIT)
def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    return svc.reset_password(body.token, body.new_password)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit(AUTH_RATE_LIMIT)
def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Rotate the refresh token. Bearer clients send it in the body; the web
    client relies on the httpOnly cookie (CSRF-checked, since it's cookie auth)."""
    token = body.refresh_token if body and body.refresh_token else None
    if not token:
        token = request.cookies.get(REFRESH_COOKIE)
        if not token:
            raise UnauthorizedError("Missing refresh token")
        enforce_csrf(request)
    tokens = svc.refresh(token)
    set_auth_cookies(response, access_token=tokens.access_token, refresh_token=tokens.refresh_token)
    return tokens


@router.post("/google", response_model=None)
@limiter.limit(AUTH_RATE_LIMIT)
def google_auth(
    request: Request,
    response: Response,
    body: GoogleAuthRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Like /login: an MFA-enabled account gets a challenge instead of tokens."""
    result = svc.google_auth(body)
    if isinstance(result, TokenResponse):
        set_auth_cookies(response, access_token=result.access_token, refresh_token=result.refresh_token)
    return result


# ── MFA (TOTP) ───────────────────────────────────────────────────────────────

@router.post("/mfa/verify", response_model=TokenResponse)
@limiter.limit(AUTH_RATE_LIMIT)
def mfa_verify(
    request: Request,
    response: Response,
    body: MfaVerifyRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Second login step for MFA accounts: challenge token + TOTP code → tokens."""
    tokens = svc.mfa_verify(body.challenge_token, body.code)
    set_auth_cookies(response, access_token=tokens.access_token, refresh_token=tokens.refresh_token)
    return tokens


@router.post("/mfa/enroll", response_model=MfaEnrollResponse)
def mfa_enroll(svc: AuthService = Depends(get_auth_service)):
    """Start TOTP enrollment: returns the secret + otpauth:// URI to load into
    an authenticator app. Pending until /mfa/enroll/verify confirms a code."""
    return svc.mfa_enroll()


@router.post("/mfa/enroll/verify")
def mfa_enroll_verify(body: MfaCodeRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.mfa_enroll_verify(body.code)


@router.post("/mfa/disable")
def mfa_disable(body: MfaCodeRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.mfa_disable(body.code)


@router.post("/mfa/backup-codes/regenerate", response_model=MfaBackupCodesResponse)
def regenerate_backup_codes(body: MfaCodeRequest, svc: AuthService = Depends(get_auth_service)):
    """Issue a fresh set of one-time backup codes (invalidates the old set).
    Requires a current TOTP code."""
    return svc.regenerate_backup_codes(body.code)


# ── Authenticated ────────────────────────────────────────────────────────────

@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Server-side logout: revokes the refresh-session family of whatever
    credentials accompany the request (Bearer header and/or session cookies),
    blocklists the live access token, and clears the cookies.

    Deliberately tolerant — holding a token is sufficient authorization to
    revoke it, and logout with an expired access token must still kill the
    refresh session rather than 401-ing and leaving it alive.
    """
    authz = request.headers.get("Authorization", "")
    raw_access = authz[7:].strip() if authz.startswith("Bearer ") else request.cookies.get(ACCESS_COOKIE)
    raw_refresh = request.cookies.get(REFRESH_COOKIE)
    if not authz and (raw_access or raw_refresh):
        # Cookie-only logout is a cookie-authenticated mutation → CSRF-check it.
        enforce_csrf(request)
    result = svc.logout(raw_access, raw_refresh)
    clear_auth_cookies(response)
    return result


@router.get("/me")
def me(svc: AuthService = Depends(get_auth_service)):
    return svc.me()


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.change_password(body)


@router.put("/me")
def update_me(body: UpdateProfileRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.update_profile(body)
