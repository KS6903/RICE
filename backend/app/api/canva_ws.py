"""Warehouse-canva realtime WebSocket (Phase 4.4).

Kept deliberately thin: one WS endpoint plus its JWT auth helper. The socket loop
and the realtime manager (``services/canva_realtime.py``) are unchanged — this is
a verbatim move of the WS code out of the old ``api/canva.py`` monolith. A
dedicated router omits the ``require_feature`` HTTP dependency (which forces
OAuth2PasswordBearer-style auth); the plan gate is enforced inline instead.
"""

import asyncio
import uuid

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi import status as http_status
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import SessionLocal
from ..core.security import (
    authenticate_access_token,
    get_user_features,
    mfa_enrollment_pending,
)
from ..core.tenancy import schema_name_for, set_search_path
from ..models.user import User
from ..models.warehouse import WarehouseLayout
from ..services.canva_realtime import manager as ws_manager

# Dedicated router for the WebSocket so we can omit the require_feature
# dependency (it forces HTTP-style auth via OAuth2PasswordBearer).
ws_router = APIRouter()


def _authenticate_ws(token: str | None, db: Session) -> tuple[User, dict] | None:
    """Apply the same durable access-token policy used by HTTP requests."""
    if not token:
        return None
    try:
        return authenticate_access_token(token, db)
    except HTTPException:
        return None
    except Exception:
        return None


_WS_BEARER_PROTOCOL = "bearer"


def _subprotocol_token(websocket: WebSocket) -> str | None:
    """Access token offered as ``Sec-WebSocket-Protocol: bearer, <jwt>``.

    Renderer/browser WebSockets cannot set an Authorization header, so the
    Electron renderer (which holds no session cookies) offers the token as the
    second subprotocol entry — the JWT charset (base64url + ".") is a valid
    RFC 6455 subprotocol token, and handshake headers stay out of URL and
    access logs. The server must echo the literal "bearer" entry back on
    accept or the client-side handshake fails.
    """
    raw = websocket.headers.get("sec-websocket-protocol", "")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) == 2 and parts[0] == _WS_BEARER_PROTOCOL:
        return parts[1]
    return None


@ws_router.websocket("/ws/canva/{layout_id}")
async def canva_ws(websocket: WebSocket, layout_id: uuid.UUID):
    """Live updates for one warehouse layout.

    Browser auth uses the httpOnly ``access_token`` cookie and must originate
    from an allowed web origin. Native clients present the access token
    instead — via ``Authorization: Bearer``, or as the ``["bearer", <token>]``
    subprotocol pair where request headers can't be set (the Electron
    renderer). Tokens in query strings are rejected. Subscribers must belong
    to the same company as the layout — otherwise we close immediately with
    policy violation.
    """
    from ..core.cookies import ACCESS_COOKIE

    db = SessionLocal()
    try:
        if websocket.query_params.get("token"):
            await websocket.close(
                code=http_status.WS_1008_POLICY_VIOLATION,
                reason="Query-string tokens are not accepted",
            )
            return
        authz = websocket.headers.get("authorization", "")
        header_token = authz[7:].strip() if authz.startswith("Bearer ") else None
        proto_token = _subprotocol_token(websocket)
        raw_token = header_token or proto_token
        if raw_token is None:
            # Cookie auth is browser-attached, so (like CSRF on HTTP) the
            # handshake must come from our own web origin. Token clients skip
            # this gate: possession of the signed token is the credential —
            # matching HTTP Bearer semantics — and the packaged desktop
            # renderer's origin is the opaque "file://"/"null".
            origin = websocket.headers.get("origin")
            if origin not in settings.origins_list:
                await websocket.close(
                    code=http_status.WS_1008_POLICY_VIOLATION,
                    reason="Origin not allowed",
                )
                return
            raw_token = websocket.cookies.get(ACCESS_COOKIE)

        authenticated = _authenticate_ws(raw_token, db)
        if not authenticated:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return
        user, payload = authenticated

        if mfa_enrollment_pending(user):
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="MFA setup required")
            return
        if settings.REQUIRE_EMAIL_VERIFICATION and user.email and not user.email_verified:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Email verification required")
            return

        # WS sessions don't go through get_db, so scope this one to the user's
        # client schema before touching any per-client table (e.g. the layout).
        if user.company is not None:
            set_search_path(db, schema_name_for(user.company))

        # Plan gate: only Pro+ tenants get realtime canva
        features = get_user_features(user, db)
        if "*" not in features and "canva_inventory" not in features:
            await websocket.close(
                code=http_status.WS_1008_POLICY_VIOLATION, reason="Plan does not include canva_inventory"
            )
            return

        layout = db.get(WarehouseLayout, layout_id)
        if not layout or layout.company_id != user.company_id:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Layout not found")
            return

        await ws_manager.connect(
            layout_id,
            websocket,
            # A client that offered the bearer subprotocol pair needs it echoed
            # back or its WebSocket API aborts the otherwise-open connection.
            subprotocol=_WS_BEARER_PROTOCOL if proto_token else None,
        )
        await websocket.send_text('{"event":"hello","payload":{"layout_id":"' + str(layout_id) + '","ok":true}}')

        try:
            # Keep the connection alive. We don't expect client→server messages
            # in this phase — the client uses HTTP for writes. Just read & drop
            # pings.
            while True:
                # JWT exp is epoch time, so calculate against UTC wall clock.
                from datetime import datetime, timezone

                remaining = float(payload["exp"]) - datetime.now(timezone.utc).timestamp()
                if remaining <= 0:
                    await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Token expired")
                    break
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=remaining)
                db.expire_all()
                current = _authenticate_ws(raw_token, db)
                if not current:
                    await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Session revoked")
                    break
                current_user, _ = current
                current_features = get_user_features(current_user, db)
                if "*" not in current_features and "canva_inventory" not in current_features:
                    await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Feature revoked")
                    break
                if msg == "ping":
                    await websocket.send_text('{"event":"pong","payload":{}}')
        except asyncio.TimeoutError:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Token expired")
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
    finally:
        await ws_manager.disconnect(layout_id, websocket)
        db.close()
