import { useEffect, useState } from "react";

export type Coords = { lat: number; lon: number };

const STORAGE_KEY = "rice-mill-last-coords";
const DENIED_KEY = "rice-mill-geo-denied"; // sticky once the user has said no

function readCached(): Coords | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === "number" && typeof parsed?.lon === "number") {
      return { lat: parsed.lat, lon: parsed.lon };
    }
    return null;
  } catch {
    return null;
  }
}

function persist(coords: Coords): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(coords)); } catch { /* storage unavailable */ }
}

/** Try to resolve the browser's precise location silently.
 *
 *  Returns the best coords we have right now:
 *    - first paint: any cached coords (so the widget renders immediately),
 *    - then: the fresh GPS fix when the browser delivers it.
 *  Returns `null` when geolocation is denied, blocked, unavailable, or timed
 *  out AND there are no cached coords. The widget treats `null` as a signal
 *  to fall back to IP-based lookup on the server.
 *
 *  Never throws, never surfaces an error, never shows UI. A previous "denied"
 *  decision is sticky via localStorage so we don't ask the browser again on
 *  every page load (it ignores us anyway, but this skips the JS call).
 */
export function useGeolocation(): Coords | null {
  const [coords, setCoords] = useState<Coords | null>(readCached);

  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;
    if (localStorage.getItem(DENIED_KEY) === "1") return; // user said no before
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        persist(next);
        setCoords(next);
      },
      (err) => {
        if (cancelled) return;
        if (err.code === err.PERMISSION_DENIED) {
          try { localStorage.setItem(DENIED_KEY, "1"); } catch { /* storage unavailable */ }
        }
        // Leave `coords` at whatever we had (cached or null) — the widget
        // will fall back to IP-based lookup when it sees null.
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 10 * 60 * 1000 },
    );
    return () => { cancelled = true; };
  }, []);

  return coords;
}
