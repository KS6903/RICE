"""Symmetric encryption for small secrets at rest (security hardening P1.9).

Used for per-user TOTP seeds: a database dump alone must not let an attacker
mint valid MFA codes. The Fernet key is derived from SECRET_KEY (SHA-256 →
urlsafe base64), so no extra key material needs managing — rotating SECRET_KEY
invalidates stored MFA secrets (users re-enroll), which is an acceptable and
explicit trade-off for this app.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_str(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_str(ciphertext: str) -> str | None:
    """Decrypt, returning None for garbage/foreign-key ciphertexts."""
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
