"""Messages to the platform owner's Discord, through webhooks.

Three channels, each its own webhook (core/config.py): feedback from Settings >
Feedback, security alerts about the BossAdmin account, and every payment a mill
sends for a plan (with the screenshot of a bank transfer attached). Sending never holds
up the request that caused it and never fails it: the post runs on a thread of
its own, and a Discord that is down or refuses is only logged.

Only Discord's own webhook addresses are used, so a mistyped setting can't send
the app's data anywhere else. Nothing sent can ping anyone (allowed_mentions).
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from pydantic import SecretStr

from .config import settings

logger = logging.getLogger("ricemill.discord")

TIMEOUT_SECONDS = 8.0
_HOSTS = {"discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"}
# Discord's limits for an embed's parts.
_TITLE_MAX = 256
_DESCRIPTION_MAX = 4096
_FIELD_NAME_MAX = 256
_FIELD_VALUE_MAX = 1024
_FIELDS_MAX = 25

GREEN = 0x16A34A
AMBER = 0xF59E0B
RED = 0xDC2626
BLUE = 0x2563EB


def webhook_ok(url: str) -> bool:
    """A Discord webhook address, over HTTPS, and nothing else."""
    try:
        parts = urlparse(url)
    except ValueError:
        return False
    return (
        parts.scheme == "https"
        and (parts.hostname or "").lower() in _HOSTS
        and parts.port is None
        and not parts.username
        and not parts.password
        and parts.path.startswith("/api/webhooks/")
    )


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def embed(
    title: str,
    *,
    description: str | None = None,
    fields: list[tuple[str, str]] | None = None,
    color: int = BLUE,
) -> dict:
    """One Discord embed, trimmed to Discord's limits."""
    out: dict = {
        "title": _cut(title, _TITLE_MAX),
        "color": color,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if description:
        out["description"] = _cut(description, _DESCRIPTION_MAX)
    if fields:
        out["fields"] = [
            {"name": _cut(name, _FIELD_NAME_MAX), "value": _cut(value or "-", _FIELD_VALUE_MAX), "inline": False}
            for name, value in fields[:_FIELDS_MAX]
        ]
    return out


# A file sent with a message: (file name, bytes, media type).
Attachment = tuple[str, bytes, str]


def _post(url: str, payload: dict, files: list[Attachment] | None = None) -> None:
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
            if files:
                # Discord takes files as multipart, with the message as payload_json.
                response = client.post(
                    url,
                    data={"payload_json": json.dumps(payload)},
                    files={f"files[{i}]": f for i, f in enumerate(files)},
                )
            else:
                response = client.post(url, json=payload)
        if response.status_code >= 400:
            logger.warning("Discord refused a message: HTTP %s", response.status_code)
    except httpx.HTTPError as exc:
        logger.warning("Discord unreachable: %s", type(exc).__name__)


def send(webhook: SecretStr | None, *embeds: dict, files: list[Attachment] | None = None, wait: bool = False) -> bool:
    """Post the embeds to the webhook, with any files. False when there's no
    usable webhook. ``wait`` sends on this thread (tests, scripts); otherwise on
    its own. An embed shows an attached picture with image.url
    "attachment://<file name>"."""
    if webhook is None:
        return False
    url = webhook.get_secret_value().strip()
    if not webhook_ok(url):
        logger.error("A Discord webhook setting isn't a Discord webhook address; nothing sent")
        return False
    payload = {
        "username": settings.APP_NAME,
        "embeds": list(embeds)[:10],
        # Text people typed can't ping @everyone, a role or a person.
        "allowed_mentions": {"parse": []},
    }
    args = (url, payload, files) if files else (url, payload)
    if wait:
        _post(*args)
    else:
        threading.Thread(target=_post, args=args, name="discord-post", daemon=True).start()
    return True


def feedback(*embeds: dict) -> bool:
    return send(settings.DISCORD_FEEDBACK_WEBHOOK_URL, *embeds)


def security(*embeds: dict) -> bool:
    return send(settings.DISCORD_SECURITY_WEBHOOK_URL, *embeds)


def payments(*embeds: dict, files: list[Attachment] | None = None) -> bool:
    return send(settings.DISCORD_PAYMENTS_WEBHOOK_URL, *embeds, files=files)
