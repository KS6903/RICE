"""Symmetric encryption for small secrets at rest (security hardening P1.9).

Used for per-user TOTP seeds: a database dump alone must not let an attacker
mint valid MFA codes. Production uses a dedicated encryption key so compromise
or rotation of the JWT signing key does not also expose/invalidate MFA seeds.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


def _fernet() -> Fernet:
    material = (
        settings.MFA_ENCRYPTION_KEY.get_secret_value()
        if settings.MFA_ENCRYPTION_KEY
        else settings.SECRET_KEY  # local-dev/backward-compatible fallback
    )
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_str(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_str(ciphertext: str) -> str | None:
    """Decrypt, returning None for garbage/foreign-key ciphertexts."""
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
