"""Security middleware — defense-in-depth HTTP response headers.

Adds hardening headers to every response. The web UI is served separately
(Vite in dev, a static host / Electron in prod), so the Content-Security-Policy
here targets the JSON API and the optional Swagger/ReDoc docs — it does not
constrain the React app.
"""
from __future__ import annotations

import logging
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from .config import settings

audit_logger = logging.getLogger("ricemill.security.audit")
_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Strict default for API responses: no scripts, no framing, no <base>, no forms.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

# Swagger/ReDoc (mounted only when DEBUG) load JS/CSS/fonts from a CDN and use
# inline styles, so they need a looser policy. Applied only on the docs paths.
_DOCS_CSP = (
    "default-src 'self'; "
    "img-src 'self' data: https://fastapi.tiangolo.com; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "worker-src 'self' blob:; "
    "frame-ancestors 'none'"
)
_DOCS_PATHS = ("/api/docs", "/api/redoc", "/api/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach security headers to every response (without clobbering any a route set)."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault(
            "Permissions-Policy",
            "geolocation=(self), camera=(), microphone=(), payment=()",
        )
        is_docs = any(request.url.path.startswith(p) for p in _DOCS_PATHS)
        headers.setdefault("Content-Security-Policy", _DOCS_CSP if is_docs else _API_CSP)
        # API responses contain tenant/account data and must never be retained
        # by shared proxies or the browser's HTTP cache.
        if request.url.path.startswith("/api/") and request.url.path != "/api/health":
            headers.setdefault("Cache-Control", "no-store")
        # HSTS only in prod: it requires HTTPS, and pinning it on http://localhost
        # would wrongly force https for local development.
        if settings.is_prod:
            headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )
        return response


class MutationAuditMiddleware(BaseHTTPMiddleware):
    """Audit every API mutation without recording bodies, tokens, or query strings."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = uuid.uuid4().hex
        response = await call_next(request)
        response.headers.setdefault("X-Request-ID", request_id)
        if request.method not in _MUTATING_METHODS or not request.url.path.startswith("/api/"):
            return response

        context = getattr(request.state, "auth_context", None) or {}
        audit_logger.info(
            "mutation request_id=%s method=%s path=%s status=%s user=%s company=%s peer=%s",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            context.get("username") or "anonymous",
            context.get("company_id") or "none",
            request.client.host if request.client else "unknown",
        )

        # Authenticated tenant mutations also get a durable in-app audit row.
        # This is deliberately a separate transaction so an audit-write outage
        # cannot roll back an already-completed business operation.
        if context.get("company_id") and context.get("schema"):
            try:
                from ..services.activity import log_activity
                from .database import SessionLocal
                from .tenancy import set_search_path

                with SessionLocal() as db:
                    set_search_path(db, context["schema"])
                    path_parts = [p for p in request.url.path.split("/") if p]
                    entity_type = (path_parts[1] if len(path_parts) > 1 else "api")[:40]
                    log_activity(
                        db,
                        company_id=context["company_id"],
                        user_id=context["user_id"],
                        action=f"api.{request.method.lower()}",
                        entity_type=entity_type,
                        entity_label=request.url.path[:200],
                        detail=f"status={response.status_code}; request_id={request_id}",
                    )
                    db.commit()
            except Exception:
                audit_logger.exception(
                    "durable mutation audit failed request_id=%s", request_id
                )
        return response
