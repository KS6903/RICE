"""Handshake authentication boundaries for the canva realtime WebSocket.

The endpoint opens its own SessionLocal (it can't use the fixture-scoped,
savepoint-wrapped get_db override), so rows seeded by the fixtures are invisible
to it and the accepted/happy path isn't testable here. What IS pinned down is
the security boundary: every unauthenticated or misdirected handshake must be
rejected before any data flows.
"""

from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from app.core.config import settings

LAYOUT_ID = "00000000-0000-0000-0000-000000000001"
ALLOWED_ORIGIN = settings.origins_list[0]


def _expect_reject(client, url: str, **kwargs) -> None:
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(url, **kwargs):
            pass


def test_query_string_token_is_rejected(client):
    _expect_reject(
        client,
        f"/ws/canva/{LAYOUT_ID}?token=whatever",
        headers={"Origin": ALLOWED_ORIGIN},
    )


def test_no_credentials_is_rejected(client):
    _expect_reject(
        client,
        f"/ws/canva/{LAYOUT_ID}",
        headers={"Origin": ALLOWED_ORIGIN},
    )


def test_cookie_handshake_from_disallowed_origin_is_rejected(client):
    _expect_reject(
        client,
        f"/ws/canva/{LAYOUT_ID}",
        headers={
            "Origin": "https://evil.example",
            "Cookie": "access_token=anything",
        },
    )


def test_cookie_handshake_without_origin_is_rejected(client):
    # Cookie auth is browser-attached; a handshake with no Origin at all is not
    # a browser and must not be able to ride an ambient cookie.
    _expect_reject(
        client,
        f"/ws/canva/{LAYOUT_ID}",
        headers={"Cookie": "access_token=anything"},
    )


def test_invalid_bearer_subprotocol_token_is_rejected(client):
    _expect_reject(
        client,
        f"/ws/canva/{LAYOUT_ID}",
        subprotocols=["bearer", "not-a-real-token"],
    )


def test_invalid_authorization_header_token_is_rejected(client):
    _expect_reject(
        client,
        f"/ws/canva/{LAYOUT_ID}",
        headers={"Authorization": "Bearer not-a-real-token"},
    )


def test_bearer_subprotocol_does_not_fall_back_to_cookies(client):
    # A presented (but invalid) token must fail closed rather than silently
    # downgrading to the cookie path and bypassing the origin gate.
    _expect_reject(
        client,
        f"/ws/canva/{LAYOUT_ID}",
        subprotocols=["bearer", "not-a-real-token"],
        headers={
            "Origin": "https://evil.example",
            "Cookie": "access_token=anything",
        },
    )
