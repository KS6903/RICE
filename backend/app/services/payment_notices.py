"""Every payment a mill sends for a plan, to the owner's Discord payments channel
(core/discord.py, DISCORD_PAYMENTS_WEBHOOK_URL).

- A bank transfer, when the mill sends it for checking: the reference from its
  receipt, the bank or e-wallet it came from, where it went, how much was due,
  and the screenshot of the payment attached.
- An online payment (PayMongo, PayPal), once the provider says it's paid.

Also where the screenshots are kept: under payment-receipts/ in the media store,
which the public media route never serves (api/media.py serves payment-qr/
only). BossAdmin reads them through /api/admin/upgrade-requests/{id}/receipt.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from ..core import discord, media_store
from ..core.exceptions import BadRequestError

logger = logging.getLogger("ricemill.payments")

RECEIPT_MAX_BYTES = 5 * 1024 * 1024
RECEIPT_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


def receipt_type(data: bytes) -> str | None:
    """PNG, JPEG or WebP, by the file's first bytes, never by what the browser
    says it is (an SVG or HTML "picture" can carry script)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def check_receipt(data: bytes) -> str:
    """The picture's type, or a refusal saying what's wrong with it."""
    if not data:
        raise BadRequestError("Add a screenshot or photo of your payment.", code="receipt_missing")
    if len(data) > RECEIPT_MAX_BYTES:
        raise BadRequestError(
            f"The screenshot is over {RECEIPT_MAX_BYTES // (1024 * 1024)} MB. Use a smaller one.",
            code="receipt_too_big",
        )
    ext = receipt_type(data)
    if ext is None:
        raise BadRequestError("The screenshot must be a PNG, JPEG or WebP picture.", code="receipt_type")
    return ext


def receipt_key(company_id, request_id, ext: str) -> str:
    return f"payment-receipts/{company_id}/{request_id}.{ext}"


def store_receipt(key: str, data: bytes, ext: str) -> None:
    media_store.put(key, data, RECEIPT_TYPES[ext])


def _peso(amount) -> str:
    return f"₱{Decimal(amount or 0):,.2f}"


def bank_transfer(
    *,
    company: str,
    requested_by: str,
    plan: str,
    interval: str,
    amount_due,
    discount,
    voucher_code: str | None,
    reference: str | None,
    paid_from: str | None,
    paid_to: str | None,
    receipt: tuple[bytes, str] | None,
) -> None:
    """A bank transfer sent for checking. Never raises: the request is saved
    whether or not Discord takes the message."""
    fields = [
        ("Mill", company),
        ("Sent by", requested_by),
        ("Plan", f"{plan}, {'1 year' if interval == 'annual' else '1 month'}"),
        (
            "Amount due",
            _peso(amount_due) + (f" (voucher {voucher_code}: {_peso(discount)} off)" if voucher_code else ""),
        ),
        ("Reference number", reference or "None given"),
        ("Paid from", paid_from or "Not said"),
        ("Paid to", paid_to or "No account set on the plan yet"),
    ]
    files = None
    card = discord.embed(
        "Bank transfer to check",
        description="Check it against the account, then approve it in BossAdmin > Upgrade Requests.",
        fields=fields,
        color=discord.AMBER,
    )
    if receipt is not None:
        data, ext = receipt
        name = f"payment-receipt.{ext}"
        files = [(name, data, RECEIPT_TYPES[ext])]
        card["image"] = {"url": f"attachment://{name}"}
    try:
        discord.payments(card, files=files)
    except Exception:  # noqa: BLE001 - a notice must never undo the request
        logger.exception("could not post the bank transfer to Discord")


def paid_online(*, company: str, plan: str, interval: str, amount: str, provider: str, reference: str) -> None:
    """An online payment the provider says is paid; the plan is already on."""
    try:
        discord.payments(
            discord.embed(
                f"Paid online: {amount}",
                description="The plan turned on by itself. Nothing to approve.",
                fields=[
                    ("Mill", company),
                    ("Plan", f"{plan}, {'1 year' if interval == 'annual' else '1 month'}"),
                    ("Through", provider),
                    ("Reference number", reference),
                ],
                color=discord.GREEN,
            )
        )
    except Exception:  # noqa: BLE001
        logger.exception("could not post the online payment to Discord")
