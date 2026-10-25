"""Uploaded pictures, read back (core/media_store.py).

Today only the payment QR codes, which any mill paying for a plan is meant to
see, so no sign-in is asked: the checkout page shows them in an <img>. Each
upload gets a new key, so a picture never changes under its address and can be
cached for good.
"""

from fastapi import APIRouter
from fastapi.responses import Response

from ..core import media_store
from ..core.exceptions import NotFoundError

router = APIRouter()

PUBLIC_PREFIXES = ("payment-qr/",)
TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


@router.get("/{key:path}")
def read_media(key: str):
    ext = key.rsplit(".", 1)[-1]
    if not key.startswith(PUBLIC_PREFIXES) or ".." in key or ext not in TYPES:
        raise NotFoundError("Not found")
    data = media_store.get(key)
    if data is None:
        raise NotFoundError("Not found")
    return Response(
        data,
        media_type=TYPES[ext],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
