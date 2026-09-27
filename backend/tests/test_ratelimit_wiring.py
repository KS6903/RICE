"""Every ``@limiter.limit`` endpoint must declare ``response: Response``.

slowapi is configured with ``headers_enabled=True`` (core/ratelimit.py), so after
running an endpoint it injects the X-RateLimit-* headers by reaching for a kwarg
literally named ``response``. An endpoint that doesn't declare one makes slowapi
raise ``parameter `response` must be an instance of starlette.responses.Response``
— which surfaces as a 500 on a route that otherwise looks fine.

The rest of the suite runs with RATE_LIMIT_ENABLED=false, and a disabled limiter
short-circuits before that injection, so this failure mode is invisible there.
These tests turn the limiter back on, which is the only way to see it.

It is a production-only bug in the most literal sense: it broke MFA enrollment and
password reset on a deployed instance while every test stayed green.
"""

from __future__ import annotations

import pytest
from fastapi import Response

from app.core.ratelimit import limiter


@pytest.fixture
def limited(monkeypatch):
    """Re-enable the rate limiter for one test (the suite disables it globally)."""
    monkeypatch.setattr(limiter, "enabled", True)
    # Fresh in-memory buckets, so an earlier test's hits can't 429 this one.
    monkeypatch.setattr(limiter, "_storage", limiter._storage.__class__())
    return limiter


# (path, json body) for the rate-limited endpoints reachable without a session.
PUBLIC_CASES = [
    ("/api/auth/forgot-password", {"identifier": "nobody-at-all"}),
    ("/api/auth/reset-password", {"token": "not-a-real-token", "new_password": "Passw0rdish"}),
    ("/api/auth/verify-email", {"token": "not-a-real-token"}),
]

# Same, for endpoints behind get_current_user.
AUTHED_CASES = [
    ("/api/auth/resend-verification", None),
    ("/api/auth/mfa/enroll", None),
    ("/api/auth/mfa/enroll/verify", {"code": "000000"}),
    ("/api/auth/mfa/disable", {"code": "000000"}),
    ("/api/auth/mfa/backup-codes/regenerate", {"code": "000000"}),
    ("/api/auth/google/link", {"credential": "not-a-real-credential"}),
    ("/api/auth/google/unlink", {}),
]


@pytest.mark.parametrize("path,body", PUBLIC_CASES)
def test_public_rate_limited_endpoints_do_not_500(client, limited, path, body):
    res = client.post(path, json=body)
    assert res.status_code != 500, f"{path} -> 500: {res.text}"


@pytest.mark.parametrize("path,body", AUTHED_CASES)
def test_authenticated_rate_limited_endpoints_do_not_500(auth_client, limited, path, body):
    res = auth_client.post(path, json=body) if body is not None else auth_client.post(path)
    assert res.status_code != 500, f"{path} -> 500: {res.text}"


def test_rate_limit_headers_are_actually_injected(client, limited):
    """Proves the injection path this guards is really exercised, rather than the
    endpoints above passing because the limiter quietly did nothing.

    Uses forgot-password because it is enumeration-safe and returns 200 whether or
    not the account exists — slowapi only injects headers on a normal return, not
    when the handler raises.
    """
    res = client.post("/api/auth/forgot-password", json={"identifier": "nobody-at-all"})
    assert res.status_code == 200, res.text
    assert any(h.lower().startswith("x-ratelimit") for h in res.headers), dict(res.headers)


def test_every_limited_auth_endpoint_declares_a_response_param():
    """Structural backstop: catches a newly added decorated endpoint before it
    ever has to be hit, including ones these tests don't enumerate."""
    import inspect

    from app.api import auth as auth_api

    offenders = []
    for name, fn in vars(auth_api).items():
        if not callable(fn) or not hasattr(fn, "__wrapped__"):
            continue
        params = inspect.signature(fn).parameters
        # Only slowapi-wrapped route handlers take `request: Request` positionally.
        if "request" not in params:
            continue
        if params.get("response") is None or params["response"].annotation is not Response:
            offenders.append(name)
    assert not offenders, (
        "these @limiter.limit endpoints are missing `response: Response` and will "
        f"return 500 once rate limiting is on: {offenders}"
    )
