"""Security middleware — defense-in-depth HTTP response headers.

Adds hardening headers to every response. The web UI is served separately
(Vite in dev, a static host / Electron in prod), so the Content-Security-Policy
here targets the JSON API and the optional Swagger/ReDoc docs — it does not
constrain the React app.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from .config import settings

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
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault(
            "Permissions-Policy",
            "geolocation=(self), camera=(), microphone=(), payment=()",
        )
        is_docs = any(request.url.path.startswith(p) for p in _DOCS_PATHS)
        headers.setdefault("Content-Security-Policy", _DOCS_CSP if is_docs else _API_CSP)
        # HSTS only in prod: it requires HTTPS, and pinning it on http://localhost
        # would wrongly force https for local development.
        if settings.is_prod:
            headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )
        return response
