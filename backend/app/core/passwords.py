"""Password policy (security hardening P1.11).

One shared validator for every path that sets a password (signup, change
password, admin-created users). Policy: 8–72 chars (72 = bcrypt's input limit),
must mix letters and digits, plus an OPT-IN breached-password check against the
HaveIBeenPwned range API (k-anonymity: only the first 5 chars of the SHA-1 ever
leave the server). The HIBP call is best-effort — offline mills and CI must
never be blocked by a third-party outage, so any network failure means "allow".
"""

from __future__ import annotations

import hashlib
import logging
import secrets

import httpx

from .config import settings
from .exceptions import BadRequestError

logger = logging.getLogger("ricemill.passwords")

MIN_LENGTH = 8
MAX_LENGTH = 72  # bcrypt's byte limit — Unicode character count is insufficient


def _is_breached(password: str) -> bool:
    """k-anonymity range query against HIBP. False on any failure (best-effort)."""
    # SHA-1 is what the HIBP range protocol is built on — it is a lookup key
    # here, not a password hash (storage uses bcrypt).
    # nosemgrep: python.lang.security.insecure-hash-algorithms.insecure-hash-algorithm-sha1
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        res = httpx.get(
            f"https://api.pwnedpasswords.com/range/{prefix}",
            headers={"Add-Padding": "true"},
            timeout=2.0,
        )
        res.raise_for_status()
    except Exception:
        logger.info("HIBP breach check unavailable — skipping (best-effort).")
        return False
    for line in res.text.splitlines():
        candidate, _, count = line.partition(":")
        if candidate == suffix:
            try:
                return int(count) > 0
            except ValueError:
                return True
    return False


# No i, l, o, 0 or 1: a temporary password is read out or copied by hand.
_TEMP_LOWER = "abcdefghjkmnpqrstuvwxyz"
_TEMP_UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"
_TEMP_DIGITS = "23456789"


def generate_temporary_password() -> str:
    """A one-time password to hand to someone locked out, such as ``Xk7m-Rp4q-Tz9w``:
    twelve random characters (about 69 bits) in three groups, always with a
    lower-case letter, an upper-case letter and a digit, so it passes the policy."""
    pool = _TEMP_LOWER + _TEMP_UPPER + _TEMP_DIGITS
    while True:
        password = "-".join("".join(secrets.choice(pool) for _ in range(4)) for _ in range(3))
        if (
            any(c in _TEMP_LOWER for c in password)
            and any(c in _TEMP_UPPER for c in password)
            and any(c in _TEMP_DIGITS for c in password)
        ):
            return password


def validate_password_strength(password: str) -> None:
    """Raise BadRequestError when the password fails policy."""
    if len(password) < MIN_LENGTH:
        raise BadRequestError(f"Password must be at least {MIN_LENGTH} characters")
    if len(password.encode("utf-8")) > MAX_LENGTH:
        raise BadRequestError(f"Password must be at most {MAX_LENGTH} UTF-8 bytes")
    has_alpha = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    if not (has_alpha and has_digit):
        raise BadRequestError("Password must contain both letters and numbers")
    if settings.PASSWORD_BREACH_CHECK and _is_breached(password):
        raise BadRequestError("This password has appeared in known data breaches. Please choose a different one.")
