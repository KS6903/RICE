"""Auth domain HTTP controllers — thin routing over AuthService (Phase 3).

Unauthenticated endpoints (signup/login/refresh/google) use a service with no
current_user; the account self-service endpoints (me/change-password/profile)
inject the authenticated user.
"""
import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..core.cookies import (
    ACCESS_COOKIE,
    MFA_TRUST_COOKIE,
    REFRESH_COOKIE,
    clear_auth_cookies,
    set_auth_cookies,
    set_mfa_trust_cookie,
)
from ..core.csrf import enforce_csrf
from ..core.database import get_db
from ..core.exceptions import UnauthorizedError
from ..core.ratelimit import AUTH_RATE_LIMIT, limiter
from ..core.security import get_access_token_payload, get_current_user
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
    VerifyEmailRequest,
)
from ..services.auth_service import AuthService

router = APIRouter()


def get_public_auth_service(request: Request, db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db, client=request.headers.get("user-agent"))


def get_auth_service(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> AuthService:
    return AuthService(db, current_user, client=request.headers.get("user-agent"))


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
    instead — the client completes login via POST /auth/mfa/verify. A device that
    already verified MFA carries an ``mfa_trust`` cookie (or X-MFA-Trust header)
    and skips straight to tokens until the next weekly reset (Sunday)."""
    trust = request.cookies.get(MFA_TRUST_COOKIE) or request.headers.get("X-MFA-Trust")
    result = svc.login(form.username, form.password, mfa_trust_token=trust)
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


@router.post("/verify-email")
@limiter.limit(AUTH_RATE_LIMIT)
def verify_email(
    request: Request,
    body: VerifyEmailRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Confirm an email address from the emailed link (unauthenticated)."""
    return svc.verify_email(body.token)


@router.post("/resend-verification")
@limiter.limit(AUTH_RATE_LIMIT)
def resend_verification(request: Request, svc: AuthService = Depends(get_auth_service)):
    """Re-send the verification link for the signed-in user's email."""
    return svc.resend_verification()


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
    """Like /login: an MFA-enabled account gets a challenge instead of tokens,
    unless this device is within its MFA trust window."""
    trust = request.cookies.get(MFA_TRUST_COOKIE) or request.headers.get("X-MFA-Trust")
    result = svc.google_auth(body, mfa_trust_token=trust)
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
    """Second login step for MFA accounts: challenge token + TOTP code → tokens.

    On success this device is remembered: an httpOnly ``mfa_trust`` cookie (and an
    ``X-MFA-Trust`` response header for bearer clients) lets it skip MFA on login
    until the next weekly reset (Sunday), so the user isn't prompted every login."""
    tokens, trust = svc.mfa_verify(body.challenge_token, body.code)
    set_auth_cookies(response, access_token=tokens.access_token, refresh_token=tokens.refresh_token)
    set_mfa_trust_cookie(response, trust)
    response.headers["X-MFA-Trust"] = trust
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


# ── Active sessions / devices ────────────────────────────────────────────────

@router.get("/sessions")
def list_sessions(
    payload: dict = Depends(get_access_token_payload),
    svc: AuthService = Depends(get_auth_service),
):
    """List the user's active login sessions (one per device), flagging the current one."""
    return svc.list_sessions(payload.get("sid"))


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: uuid.UUID, svc: AuthService = Depends(get_auth_service)):
    """Revoke a single session/device."""
    return svc.revoke_session(session_id)


@router.post("/sessions/revoke-others")
def revoke_other_sessions(
    payload: dict = Depends(get_access_token_payload),
    svc: AuthService = Depends(get_auth_service),
):
    """Sign out every device except the current one."""
    return svc.revoke_other_sessions(payload.get("sid"))


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
