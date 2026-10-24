"""Auth domain HTTP controllers — thin routing over AuthService (Phase 3).

Unauthenticated endpoints (signup/login/refresh/google) use a service with no
current_user; the account self-service endpoints (me/change-password/profile)
inject the authenticated user.
"""

import secrets
import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..core.access_policy import access_for_user
from ..core.config import settings
from ..core.cookies import (
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    clear_auth_cookies,
    is_mfa_trust_cookie,
    set_auth_cookies,
    set_mfa_trust_cookie,
)
from ..core.csrf import enforce_csrf
from ..core.database import get_db
from ..core.exceptions import UnauthorizedError
from ..core.ratelimit import AUTH_RATE_LIMIT, client_ip, limiter
from ..core.security import get_access_token_payload, get_current_user
from ..schemas.auth import (
    BrowserAuthResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    GoogleLinkRequest,
    GoogleUnlinkRequest,
    LockoutHelpRequest,
    MfaBackupCodesResponse,
    MfaCodeRequest,
    MfaDisableRequest,
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
MFA_RATE_LIMIT = "5/minute"
LOCKOUT_HELP_RATE_LIMIT = "5/hour"
# However many a client sends, a login checks no more trust tokens than this.
MAX_MFA_TRUST_TOKENS = 20


def _is_bearer_client(request: Request) -> bool:
    """Return true only for an explicit non-browser/native token client."""
    if not secrets.compare_digest(request.headers.get("X-Client-Type", ""), "bearer"):
        return False
    origin = request.headers.get("origin")
    user_agent = request.headers.get("user-agent", "")
    if "Electron" not in user_agent:
        return origin is None
    if origin is None or origin == "null":
        return True
    # Electron's development renderer is served by Vite rather than file://.
    # Limit this exception to the configured local dev origin; production still
    # requires the packaged opaque origin and cannot be opted into by a website.
    return settings.ENV == "dev" and origin == settings.FRONTEND_BASE_URL


def _mfa_trust_tokens(request: Request) -> list[str]:
    """The "remember this device" tokens the client carries, one per account
    that passed 2FA on it: a browser's per-account cookies, or the desktop app's
    X-MFA-Trust header (comma-separated)."""
    if _is_bearer_client(request):
        tokens = [token.strip() for token in request.headers.get("X-MFA-Trust", "").split(",")]
    else:
        tokens = [value for name, value in request.cookies.items() if is_mfa_trust_cookie(name)]
    return [token for token in tokens if token][:MAX_MFA_TRUST_TOKENS]


def _complete_auth(request: Request, response: Response, tokens: TokenResponse):
    """Set browser cookies without reflecting bearer secrets into JavaScript."""
    response.headers["Cache-Control"] = "no-store"
    if _is_bearer_client(request):
        return tokens
    set_auth_cookies(
        response,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
    )
    return BrowserAuthResponse()


def get_public_auth_service(request: Request, db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db, client=request.headers.get("user-agent"), ip=client_ip(request))


def get_auth_service(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> AuthService:
    return AuthService(db, current_user, client=request.headers.get("user-agent"), ip=client_ip(request))


# ── Unauthenticated ──────────────────────────────────────────────────────────


@router.get("/signup-config")
def signup_config():
    """What the sign-up form needs: whether to ask for an invite code, and the
    public Turnstile site key to render (null when Turnstile is off)."""
    from ..core import turnstile

    return {
        "invite_required": not settings.SIGNUP_OPEN,
        "turnstile_site_key": settings.TURNSTILE_SITE_KEY if turnstile.required() else None,
    }


@router.post("/signup", response_model=None, status_code=status.HTTP_201_CREATED)
@limiter.limit(AUTH_RATE_LIMIT)
def signup(
    request: Request,
    response: Response,
    body: SignupRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    tokens = svc.signup(body, request=request)
    return _complete_auth(request, response, tokens)


@router.post("/login", response_model=None)
@limiter.limit(AUTH_RATE_LIMIT)
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    svc: AuthService = Depends(get_public_auth_service),
):
    """Authenticate a browser with cookies or an explicit native client with tokens.

    Accounts with MFA enabled get ``{"mfa_required": true, "challenge_token"}``
    instead — the client completes login via POST /auth/mfa/verify. A device where
    this account already verified MFA carries its trust cookie (or X-MFA-Trust
    header) and skips straight to tokens until the next weekly reset (Sunday)."""
    result = svc.login(form.username, form.password, mfa_trust_tokens=_mfa_trust_tokens(request))
    if isinstance(result, TokenResponse):
        return _complete_auth(request, response, result)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/forgot-password")
@limiter.limit(AUTH_RATE_LIMIT)
def forgot_password(
    request: Request,
    response: Response,
    body: ForgotPasswordRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Request a password reset. Always responds the same way (no account
    enumeration); the reset link is delivered out-of-band."""
    return svc.request_password_reset(body.identifier)


@router.post("/lockout-help")
@limiter.limit(LOCKOUT_HELP_RATE_LIMIT)
def lockout_help(
    request: Request,
    response: Response,
    body: LockoutHelpRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """A locked-out Boss asks the platform admin for a temporary password. Always
    responds the same way (no account enumeration)."""
    return svc.request_lockout_help(body.username, body.message)


@router.post("/reset-password")
@limiter.limit(AUTH_RATE_LIMIT)
def reset_password(
    request: Request,
    response: Response,
    body: ResetPasswordRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    return svc.reset_password(body.token, body.new_password)


@router.post("/verify-email")
@limiter.limit(AUTH_RATE_LIMIT)
def verify_email(
    request: Request,
    response: Response,
    body: VerifyEmailRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Confirm an email address from the emailed link (unauthenticated)."""
    return svc.verify_email(body.token)


@router.post("/resend-verification")
@limiter.limit(AUTH_RATE_LIMIT)
def resend_verification(
    request: Request,
    response: Response,
    svc: AuthService = Depends(get_auth_service),
):
    """Re-send the verification link for the signed-in user's email."""
    return svc.resend_verification()


@router.post("/refresh", response_model=None)
@limiter.limit(AUTH_RATE_LIMIT)
def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Rotate the refresh token. Bearer clients send it in the body; the web
    client relies on the httpOnly cookie (CSRF-checked, since it's cookie auth)."""
    bearer_client = _is_bearer_client(request)
    token = body.refresh_token if bearer_client and body and body.refresh_token else None
    if bearer_client and not token:
        raise UnauthorizedError("Bearer clients must provide a refresh token")
    if not bearer_client:
        token = request.cookies.get(REFRESH_COOKIE)
        if not token:
            raise UnauthorizedError("Missing refresh token")
        enforce_csrf(request)
    assert token is not None
    tokens = svc.refresh(token)
    return _complete_auth(request, response, tokens)


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
    result = svc.google_auth(body, mfa_trust_tokens=_mfa_trust_tokens(request), request=request)
    if isinstance(result, TokenResponse):
        return _complete_auth(request, response, result)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/google/link")
@limiter.limit(MFA_RATE_LIMIT)
def link_google_identity(
    request: Request,
    response: Response,
    body: GoogleLinkRequest,
    svc: AuthService = Depends(get_auth_service),
):
    """Link Google only after an authenticated user re-proves account control."""
    return svc.link_google_identity(body)


@router.post("/google/unlink")
@limiter.limit(MFA_RATE_LIMIT)
def unlink_google_identity(
    request: Request,
    response: Response,
    body: GoogleUnlinkRequest,
    svc: AuthService = Depends(get_auth_service),
):
    return svc.unlink_google_identity(body)


# ── MFA (TOTP) ───────────────────────────────────────────────────────────────


@router.post("/mfa/verify", response_model=None)
@limiter.limit(AUTH_RATE_LIMIT)
def mfa_verify(
    request: Request,
    response: Response,
    body: MfaVerifyRequest,
    svc: AuthService = Depends(get_public_auth_service),
):
    """Second login step for MFA accounts: challenge token + TOTP code → tokens.

    On success this device is remembered for this account: an httpOnly trust
    cookie (an ``X-MFA-Trust`` response header for bearer clients) lets it skip MFA on login
    until the next weekly reset (Sunday 00:00 in the user's local time), so the
    user isn't prompted every login."""
    tokens, trust = svc.mfa_verify(body.challenge_token, body.code, body.timezone)
    if _is_bearer_client(request):
        response.headers["X-MFA-Trust"] = trust
        response.headers["Cache-Control"] = "no-store"
        return tokens
    set_auth_cookies(response, access_token=tokens.access_token, refresh_token=tokens.refresh_token)
    set_mfa_trust_cookie(response, trust)
    response.headers["Cache-Control"] = "no-store"
    return BrowserAuthResponse()


@router.post("/mfa/enroll", response_model=MfaEnrollResponse)
@limiter.limit(MFA_RATE_LIMIT)
def mfa_enroll(
    request: Request,
    response: Response,
    svc: AuthService = Depends(get_auth_service),
):
    """Start TOTP enrollment: returns the secret + otpauth:// URI to load into
    an authenticator app. Pending until /mfa/enroll/verify confirms a code."""
    return svc.mfa_enroll()


@router.post("/mfa/enroll/verify")
@limiter.limit(MFA_RATE_LIMIT)
def mfa_enroll_verify(
    request: Request,
    response: Response,
    body: MfaCodeRequest,
    svc: AuthService = Depends(get_auth_service),
):
    return svc.mfa_enroll_verify(body.code)


@router.post("/mfa/disable")
@limiter.limit(MFA_RATE_LIMIT)
def mfa_disable(
    request: Request,
    response: Response,
    body: MfaDisableRequest,
    svc: AuthService = Depends(get_auth_service),
):
    return svc.mfa_disable(body.code, body.password)


@router.post("/mfa/backup-codes/regenerate", response_model=MfaBackupCodesResponse)
@limiter.limit(MFA_RATE_LIMIT)
def regenerate_backup_codes(
    request: Request,
    response: Response,
    body: MfaCodeRequest,
    svc: AuthService = Depends(get_auth_service),
):
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
    has_bearer = authz.startswith("Bearer ") and bool(authz[7:].strip())
    raw_access = authz[7:].strip() if has_bearer else request.cookies.get(ACCESS_COOKIE)
    raw_refresh = request.cookies.get(REFRESH_COOKIE)
    if not has_bearer and (raw_access or raw_refresh):
        # Cookie-only logout is a cookie-authenticated mutation → CSRF-check it.
        enforce_csrf(request)
    result = svc.logout(raw_access, raw_refresh)
    clear_auth_cookies(response)
    return result


# Polled by every open tab: exempt from the per-IP default limit, which would
# otherwise spend Redis commands (Upstash bills per command) on every poll.
@router.get("/me")
@limiter.exempt
def me(svc: AuthService = Depends(get_auth_service)):
    result = svc.me()
    # Every page's level for this person, with the changes their mill's Boss has
    # made to the role matrix. Polled with the rest, so a change reaches an open
    # tab without a sign-in.
    result["access"] = access_for_user(svc.current_user)
    return result


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.change_password(body)


@router.put("/me")
def update_me(body: UpdateProfileRequest, svc: AuthService = Depends(get_auth_service)):
    return svc.update_profile(body)
