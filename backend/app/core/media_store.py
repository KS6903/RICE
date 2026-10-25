"""Where uploaded pictures live: Cloudflare R2, or a folder on this computer.

Today that is the QR codes BossAdmin puts on each plan's payment account. R2 is
reached through its S3-compatible API with an access key of its own (R2_*), so
the API needs no Worker binding. Without R2 (local development and tests) the
files go to MEDIA_DIR. A deployed site never falls back to the folder: a
container's disk is wiped on every restart, and the picture would go with it.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx

from .config import settings
from .exceptions import NotConfiguredError, ServiceUnavailableError

logger = logging.getLogger("ricemill.media")

TIMEOUT_SECONDS = 20.0


def r2_enabled() -> bool:
    return bool(
        settings.R2_ACCOUNT_ID and settings.R2_ACCESS_KEY_ID and settings.R2_SECRET_ACCESS_KEY and settings.R2_BUCKET
    )


def can_store() -> bool:
    return r2_enabled() or settings.ENV in ("dev", "test")


# ── R2 (S3 API, signature version 4) ─────────────────────────────────────────


def _r2_request(method: str, key: str, body: bytes = b"", content_type: str | None = None) -> httpx.Response:
    assert settings.R2_SECRET_ACCESS_KEY is not None
    host = f"{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    uri = f"/{settings.R2_BUCKET}/{quote(key, safe='/-_.~')}"
    now = datetime.now(timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    signed = "host;x-amz-content-sha256;x-amz-date"
    canonical = "\n".join(
        [
            method,
            uri,
            "",
            f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n",
            signed,
            payload_hash,
        ]
    )
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signing_key = f"AWS4{settings.R2_SECRET_ACCESS_KEY.get_secret_value()}".encode()
    for part in (day, "auto", "s3", "aws4_request"):
        signing_key = hmac.new(signing_key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing_key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers = {
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={settings.R2_ACCESS_KEY_ID}/{scope}, "
            f"SignedHeaders={signed}, Signature={signature}"
        ),
    }
    if content_type:
        headers["Content-Type"] = content_type
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        return client.request(method, f"https://{host}{uri}", content=body, headers=headers)


# ── the folder ───────────────────────────────────────────────────────────────


def _local_path(key: str) -> Path:
    root = Path(settings.MEDIA_DIR).resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise ValueError("Media key leaves the media folder")
    return path


# ── the three calls ──────────────────────────────────────────────────────────


def put(key: str, data: bytes, content_type: str) -> None:
    if r2_enabled():
        try:
            res = _r2_request("PUT", key, data, content_type)
            res.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("R2 upload of %s failed: %s", key, exc)
            raise ServiceUnavailableError("The picture couldn't be saved. Try again in a minute.") from exc
        return
    if not can_store():
        raise NotConfiguredError("Picture uploads need Cloudflare R2 set up (R2_* settings).")
    path = _local_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def get(key: str) -> bytes | None:
    if r2_enabled():
        try:
            res = _r2_request("GET", key)
        except httpx.HTTPError as exc:
            logger.warning("R2 read of %s failed: %s", key, exc)
            return None
        return res.content if res.status_code == 200 else None
    try:
        path = _local_path(key)
    except ValueError:
        return None
    return path.read_bytes() if path.is_file() else None


def delete(key: str) -> None:
    """Best effort: a picture left behind costs a few kilobytes, never an error."""
    try:
        if r2_enabled():
            _r2_request("DELETE", key)
        else:
            _local_path(key).unlink(missing_ok=True)
    except (httpx.HTTPError, ValueError, OSError) as exc:
        logger.warning("removing %s failed: %s", key, exc)
