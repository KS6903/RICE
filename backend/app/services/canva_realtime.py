"""In-memory WebSocket pub/sub for the warehouse canva.

Single-process, single-instance — fine for Phase 3 dev. For horizontal scaling,
swap _ConnectionManager for a Redis-backed implementation without touching
the call sites in api/canva.py.
"""
import asyncio
import json
import uuid
from collections import defaultdict
from contextlib import suppress
from typing import Any

from fastapi import WebSocket


class CanvaConnectionManager:
    """Holds active WebSocket subscribers keyed by layout_id."""

    def __init__(self) -> None:
        self._subs: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, layout_id: uuid.UUID, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._subs[layout_id].add(ws)

    async def disconnect(self, layout_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            if layout_id in self._subs:
                self._subs[layout_id].discard(ws)
                if not self._subs[layout_id]:
                    del self._subs[layout_id]

    async def broadcast(
        self,
        layout_id: uuid.UUID,
        event: str,
        payload: dict[str, Any],
        exclude: WebSocket | None = None,
    ) -> None:
        """Send {event, payload} to every subscriber of this layout.

        Dead sockets are quietly removed. Callers don't need to await ordering
        between subscribers — broadcasts fire in parallel.
        """
        async with self._lock:
            targets = [w for w in self._subs.get(layout_id, set()) if w is not exclude]

        if not targets:
            return

        msg = json.dumps({"event": event, "payload": payload})
        dead: list[WebSocket] = []

        async def _send(w: WebSocket) -> None:
            try:
                await w.send_text(msg)
            except Exception:
                dead.append(w)

        await asyncio.gather(*(_send(w) for w in targets), return_exceptions=True)

        if dead:
            async with self._lock:
                for w in dead:
                    for lid in list(self._subs.keys()):
                        self._subs[lid].discard(w)

    def set_main_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Captured at FastAPI startup so sync handlers can schedule broadcasts
        onto the same loop that owns the WebSocket connections."""
        self._main_loop = loop

    def broadcast_sync(self, layout_id: uuid.UUID, event: str, payload: dict[str, Any]) -> None:
        """Fire-and-forget broadcast usable from synchronous request handlers.

        Why: FastAPI runs sync route handlers in a thread pool, so the local
        event loop differs from the one running the WebSocket connections.
        We use run_coroutine_threadsafe to bridge the gap.
        """
        loop = getattr(self, "_main_loop", None)
        if loop is None or loop.is_closed():
            return
        with suppress(Exception):
            asyncio.run_coroutine_threadsafe(
                self.broadcast(layout_id, event, payload), loop
            )


manager = CanvaConnectionManager()
