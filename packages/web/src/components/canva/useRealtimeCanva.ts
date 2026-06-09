import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../stores/authStore";

type Status = "offline" | "connecting" | "live";

// Stop retrying after this many consecutive failed connects. Without a cap, a
// backgrounded tab whose access token has expired would reconnect to
// /ws/canva forever (403 each time), and that steady never-succeeding churn
// piles up on the single-worker backend until it wedges. When the token is
// refreshed (the axios interceptor updates the store on the next API call),
// this effect re-runs and the counter resets, so an active session recovers.
const MAX_RECONNECT_ATTEMPTS = 10;

type CanvaEvent =
  | { event: "hello"; payload: { layout_id: string; ok: boolean } }
  | { event: "pallet.moved"; payload: { pallet: any; by_user_id: string } }
  | { event: "pallet.stacked"; payload: { pallet: any; parent_id: string; by_user_id: string } }
  | { event: "pallet.unstacked"; payload: { pallet: any; by_user_id: string } }
  | { event: "zone.created"; payload: { zone: any; by_user_id: string } }
  | { event: "zone.updated"; payload: { zone: any; by_user_id: string } }
  | { event: "zone.deleted"; payload: { zone_id: string; by_user_id: string } }
  | { event: "layout.updated"; payload: { layout: any; by_user_id: string } }
  | { event: "pong"; payload: {} };

/** Subscribes to /ws/canva/{layout_id} and applies remote events to the
 *  ["canva", cacheKey] React Query cache. Auto-reconnects with backoff. */
/** cacheKey must match the React Query key used for the canva data: layoutId when a specific
 *  layout is selected, otherwise branchId (the fallback used before a layout is picked). */
export function useRealtimeCanva(layoutId: string | undefined, cacheKey: string) {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [status, setStatus] = useState<Status>("offline");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const closedManually = useRef(false);
  const pingTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!layoutId || !token) return;
    closedManually.current = false;
    // Fresh token/layout → fresh budget of reconnect attempts.
    reconnectAttempt.current = 0;

    const connect = () => {
      setStatus("connecting");
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      // Vite proxies websockets too when configured; here we hit the backend directly
      // because the dev proxy in vite.config.ts only forwards /api over HTTP.
      const url = `${proto}://${window.location.hostname}:8000/ws/canva/${layoutId}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("live");
        reconnectAttempt.current = 0;
        if (pingTimer.current) window.clearInterval(pingTimer.current);
        pingTimer.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 25_000);
      };

      ws.onmessage = (e) => {
        let data: CanvaEvent;
        try { data = JSON.parse(e.data); } catch { return; }

        if (data.event === "hello" || data.event === "pong") return;

        const apply = (updated: any) => {
          qc.setQueryData(["canva", cacheKey], (old: any) => {
            if (!old) return old;
            return {
              ...old,
              pallets: old.pallets.map((p: any) => p.id === updated.id ? updated : p),
            };
          });
        };

        const payload: any = data.payload;
        // Ignore events caused by ourselves — we already applied them optimistically
        if (payload.by_user_id && payload.by_user_id === userId) return;

        if (data.event === "pallet.moved" || data.event === "pallet.stacked" || data.event === "pallet.unstacked") {
          apply(payload.pallet);
          qc.invalidateQueries({ queryKey: ["pallet-movements", payload.pallet.id] });
        } else if (data.event === "zone.created") {
          qc.setQueryData(["canva", cacheKey], (old: any) => {
            if (!old) return old;
            return { ...old, zones: [...old.zones, payload.zone] };
          });
        } else if (data.event === "zone.updated") {
          qc.setQueryData(["canva", cacheKey], (old: any) => {
            if (!old) return old;
            return { ...old, zones: old.zones.map((z: any) => z.id === payload.zone.id ? payload.zone : z) };
          });
        } else if (data.event === "zone.deleted") {
          qc.setQueryData(["canva", cacheKey], (old: any) => {
            if (!old) return old;
            return { ...old, zones: old.zones.filter((z: any) => z.id !== payload.zone_id) };
          });
        } else if (data.event === "layout.updated") {
          qc.setQueryData(["canva", cacheKey], (old: any) => {
            if (!old) return old;
            return { ...old, layout: { ...old.layout, ...payload.layout } };
          });
        }
      };

      ws.onclose = () => {
        if (pingTimer.current) { window.clearInterval(pingTimer.current); pingTimer.current = null; }
        wsRef.current = null;
        setStatus("offline");
        if (closedManually.current) return;
        // Give up after a bounded number of failures so an expired-token tab
        // doesn't reconnect forever and hammer the backend. Recovers on the next
        // token refresh (this effect re-runs with a fresh token and resets).
        if (reconnectAttempt.current >= MAX_RECONNECT_ATTEMPTS) {
          console.warn("[canva] realtime gave up after repeated failures; will retry on token refresh.");
          return;
        }
        // Exponential backoff: 1s, 2s, 4s, 8s, capped at 15s
        const delay = Math.min(15_000, 1000 * Math.pow(2, reconnectAttempt.current));
        reconnectAttempt.current++;
        window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire right after
      };
    };

    connect();

    return () => {
      closedManually.current = true;
      if (pingTimer.current) { window.clearInterval(pingTimer.current); pingTimer.current = null; }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, [layoutId, token, cacheKey, userId, qc]);

  return status;
}
