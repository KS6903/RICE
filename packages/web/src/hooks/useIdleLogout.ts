import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

/**
 * Auto sign-out after this long without any user interaction. A mill-floor
 * terminal left unattended must not stay authenticated: on expiry we call
 * authStore.logout() (which drops the server session + cookies, not just the
 * in-memory state) and route to the login page.
 */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// What counts as "the user is still here": pointer, keyboard, wheel, touch, and
// scroll — covering desktop mice, laptop trackpads, and touchscreen terminals.
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

// Capture phase + passive: we observe every interaction (even if a handler
// stops propagation) without ever blocking the event.
const LISTENER_OPTS: AddEventListenerOptions = { capture: true, passive: true };

/**
 * Signs the user out and sends them to `/login?reason=idle` after `timeoutMs`
 * of inactivity. No-op while logged out. Must be used inside the Router.
 */
export function useIdleLogout(timeoutMs: number = IDLE_TIMEOUT_MS): void {
  const navigate = useNavigate();
  // isAuthenticated() is derived and wouldn't re-run this effect when it flips,
  // so subscribe to the underlying fields that change on login/logout.
  const isAuthed = useAuthStore((s) => !!s.user || !!s.accessToken);

  useEffect(() => {
    if (!isAuthed) return;

    let lastActivity = Date.now();
    let timer: number | undefined;

    const expire = () => {
      const { user, accessToken, logout } = useAuthStore.getState();
      if (!user && !accessToken) return; // already signed out elsewhere
      void logout();
      navigate("/login?reason=idle", { replace: true });
    };

    // Self-correcting: rather than re-arm on every mousemove, we let the timer
    // fire and recompute how much idle time is really left. Comparing wall-clock
    // timestamps also means a machine that slept past the window logs out on wake.
    const tick = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const idleFor = Date.now() - lastActivity;
      if (idleFor >= timeoutMs) {
        expire();
        return;
      }
      timer = window.setTimeout(tick, timeoutMs - idleFor);
    };

    const onActivity = () => {
      lastActivity = Date.now();
    };

    const onVisibilityChange = () => {
      // Coming back to a tab that idled in the background should log out promptly
      // instead of waiting on the browser's throttled background timers.
      if (document.visibilityState === "visible") tick();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, LISTENER_OPTS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    timer = window.setTimeout(tick, timeoutMs);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity, LISTENER_OPTS);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isAuthed, timeoutMs, navigate]);
}
