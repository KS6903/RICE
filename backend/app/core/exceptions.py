"""Application exception hierarchy + a single global handler.

Part of the OOP-standardization refactor (Phase 1). Service and repository layers
raise these semantic exceptions instead of FastAPI's ``HTTPException`` directly,
which keeps business logic free of HTTP concerns. One handler (registered in
``main.py``) maps them to responses.

Response envelope: ``{"detail": <message>, "code": <machine code>}``. The
``detail`` key is kept identical to FastAPI's default so the frontend axios
interceptor (and the 402 billing banner) keep working unchanged; ``code`` is an
additive, backward-compatible field for programmatic handling.
"""
from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("ricemill.errors")


class AppException(Exception):
    """Base for all domain/application errors. Maps to an HTTP response."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        self.message = message
        if code is not None:
            self.code = code
        super().__init__(message)


class BadRequestError(AppException):
    status_code = 400
    code = "bad_request"


class UnauthorizedError(AppException):
    status_code = 401
    code = "unauthorized"


class NotConfiguredError(AppException):
    """A server-side capability isn't configured (e.g. Google OAuth) — HTTP 501."""

    status_code = 501
    code = "not_configured"


class NotFoundError(AppException):
    status_code = 404
    code = "not_found"


class ConflictError(AppException):
    status_code = 409
    code = "conflict"


class PermissionDeniedError(AppException):
    status_code = 403
    code = "forbidden"


class ValidationError(AppException):
    status_code = 422
    code = "validation_error"


class FeatureRequiredError(AppException):
    status_code = 402
    code = "feature_required"


class TooManyRequestsError(AppException):
    """Rate limit or account lockout tripped — HTTP 429."""

    status_code = 429
    code = "rate_limited"


class ServiceUnavailableError(AppException):
    """A safe retry is required while an isolated backend operation finishes."""

    status_code = 503
    code = "service_unavailable"


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Render an AppException as ``{"detail", "code"}`` with its status code."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "code": exc.code},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unexpected errors: log the traceback server-side, return a
    generic body. Without this, an unhandled exception can leak stack traces /
    internal paths to the client (especially with debug servers)."""
    logger.exception(
        "Unhandled error on %s %s", request.method, request.url.path, exc_info=exc
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "code": "internal_error"},
    )


def register_exception_handlers(app) -> None:
    """Wire the AppException handler onto a FastAPI app. Additive: existing
    ``raise HTTPException(...)`` call sites are unaffected."""
    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
