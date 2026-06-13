"""Warehouse-canva realtime WebSocket (Phase 4.4).

Kept deliberately thin: one WS endpoint plus its JWT auth helper. The socket loop
and the realtime manager (``services/canva_realtime.py``) are unchanged — this is
a verbatim move of the WS code out of the old ``api/canva.py`` monolith. A
dedicated router omits the ``require_feature`` HTTP dependency (which forces
OAuth2PasswordBearer-style auth); the plan gate is enforced inline instead.
"""
import uuid

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status as http_status
from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.security import decode_token, get_user_features
from ..core.tenancy import schema_name_for, set_search_path
from ..models.user import User
from ..models.warehouse import WarehouseLayout
from ..services.canva_realtime import manager as ws_manager

# Dedicated router for the WebSocket so we can omit the require_feature
# dependency (it forces HTTP-style auth via OAuth2PasswordBearer).
ws_router = APIRouter()


def _authenticate_ws(token: str | None, db: Session) -> User | None:
    """Decode a JWT from the WS query string and return the user, or None."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        user = db.get(User, user_id)
        if not user or not user.is_active:
            return None
        return user
    except HTTPException:
        return None
    except Exception:
        return None


@ws_router.websocket("/ws/canva/{layout_id}")
async def canva_ws(websocket: WebSocket, layout_id: uuid.UUID, token: str | None = None):
    """Live updates for one warehouse layout.

    Auth: ?token=<access JWT> (bearer clients), or the httpOnly ``access_token``
    session cookie (web client — browsers attach cookies on same-site WS
    handshakes, and SameSite=Strict keeps cross-site pages from opening one).
    Subscribers must belong to the same company as the layout — otherwise we
    close immediately with policy violation.
    """
    from ..core.cookies import ACCESS_COOKIE

    db = SessionLocal()
    try:
        user = _authenticate_ws(token or websocket.cookies.get(ACCESS_COOKIE), db)
        if not user:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return

        # WS sessions don't go through get_db, so scope this one to the user's
        # client schema before touching any per-client table (e.g. the layout).
        if user.company is not None:
            set_search_path(db, schema_name_for(user.company))

        # Plan gate: only Pro+ tenants get realtime canva
        features = get_user_features(user, db)
        if "*" not in features and "canva_inventory" not in features:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Plan does not include canva_inventory")
            return

        layout = db.get(WarehouseLayout, layout_id)
        if not layout or layout.company_id != user.company_id:
            await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION, reason="Layout not found")
            return

        await ws_manager.connect(layout_id, websocket)
        await websocket.send_text(
            '{"event":"hello","payload":{"layout_id":"' + str(layout_id) + '","ok":true}}'
        )

        try:
            # Keep the connection alive. We don't expect client→server messages
            # in this phase — the client uses HTTP for writes. Just read & drop
            # pings.
            while True:
                msg = await websocket.receive_text()
                if msg == "ping":
                    await websocket.send_text('{"event":"pong","payload":{}}')
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
    finally:
        await ws_manager.disconnect(layout_id, websocket)
        db.close()
