import { useMemo } from "react";
import { useGeolocation } from "./useGeolocation";
import { useLocations, type SavedLocation } from "./useLocations";

export type ActiveLocation =
  | { source: "saved"; lat: number; lon: number; label: string; saved: SavedLocation }
  | { source: "gps"; lat: number; lon: number; label: null }
  | { source: "ip"; lat: null; lon: null; label: null }; // backend resolves via IP

/** Single source of truth for which coordinates the weather widget uses.
 *
 *  Priority:
 *    1. The user's default saved location (set in the LocationPicker).
 *    2. Browser GPS, if the user has previously allowed it.
 *    3. None — backend falls back to IP-based resolution.
 *
 *  Saved beats GPS deliberately: if the user took the trouble to save Manila
 *  and is currently logging in from Tokyo, they still want Manila weather. */
export function useActiveLocation(): ActiveLocation {
  const { list } = useLocations();
  const gps = useGeolocation();

  return useMemo<ActiveLocation>(() => {
    const saved = list.data?.find((l) => l.is_default) ?? null;
    if (saved) {
      return { source: "saved", lat: saved.lat, lon: saved.lon, label: saved.label, saved };
    }
    if (gps) {
      return { source: "gps", lat: gps.lat, lon: gps.lon, label: null };
    }
    return { source: "ip", lat: null, lon: null, label: null };
  }, [list.data, gps]);
}
