"""Symmetric encryption for data at rest (security hardening P1.9).

Used for per-user TOTP seeds: a database dump alone must not let an attacker
mint valid MFA codes. Production uses a dedicated encryption key so compromise
or rotation of the JWT signing key does not also expose/invalidate MFA seeds.

The same key is the root of the mills' backup files (services/data_backup.py):
each file's key is derived from it, so it can never be rotated without leaving
every TOTP seed and every backup a customer holds unreadable.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import settings


def _root_material() -> bytes:
    material = (
        settings.MFA_ENCRYPTION_KEY.get_secret_value()
        if settings.MFA_ENCRYPTION_KEY
        else settings.SECRET_KEY  # local-dev/backward-compatible fallback
    )
    return material.encode("utf-8")


def _fernet() -> Fernet:
    digest = hashlib.sha256(_root_material()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def derive_key(*, purpose: bytes, salt: bytes) -> bytes:
    """A 256-bit key for one purpose (HKDF-SHA256 over the root key).

    ``purpose`` separates uses, so a key made for one can never decrypt
    another's data; ``salt`` makes it unique per file."""
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=purpose).derive(_root_material())


def encrypt_str(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_str(ciphertext: str) -> str | None:
    """Decrypt, returning None for garbage/foreign-key ciphertexts."""
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
