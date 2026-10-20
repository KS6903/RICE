"""Cloudflare Turnstile on the sign-up form: the browser solves the challenge, the
API checks the token with Cloudflare before an account is made.

Required whenever TURNSTILE_SECRET is set; with sign-up open to anyone,
production and the preview refuse to boot without it (core/config.py). The
check fails closed: a missing, oversized or replayed token, an unreachable
siteverify, a different action, or a hostname that isn't ours all refuse.
"""

from __future__ import annotations

import logging

import httpx

from .config import settings
from .exceptions import PermissionDeniedError

logger = logging.getLogger("ricemill.turnstile")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SIGNUP_ACTION = "signup"
_MAX_TOKEN_LENGTH = 2048


def required() -> bool:
    return settings.TURNSTILE_SECRET is not None


def expected_hostnames() -> set[str]:
    return {h.strip().lower() for h in settings.TURNSTILE_HOSTNAMES.split(",") if h.strip()}


def verify(token: str | None, *, action: str, remote_ip: str | None) -> None:
    """Raise PermissionDeniedError unless Cloudflare vouches for ``token``."""
    secret = settings.TURNSTILE_SECRET
    if secret is None:
        return
    refused = PermissionDeniedError("The bot check didn't pass. Reload the page and try again.")
    hostnames = expected_hostnames()
    if not isinstance(token, str) or not token or len(token) > _MAX_TOKEN_LENGTH or not hostnames:
        raise refused
    form = {"secret": secret.get_secret_value(), "response": token}
    if remote_ip:
        form["remoteip"] = remote_ip
    try:
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            response = client.post(SITEVERIFY_URL, data=form)
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("Turnstile siteverify unreachable or unreadable; sign-up refused")
        raise refused from None
    if (
        not isinstance(result, dict)
        or result.get("success") is not True
        or result.get("action") != action
        or str(result.get("hostname", "")).lower() not in hostnames
    ):
        logger.info(
            "Turnstile refused a %s: %s", action, result.get("error-codes") if isinstance(result, dict) else "?"
        )
        raise refused
