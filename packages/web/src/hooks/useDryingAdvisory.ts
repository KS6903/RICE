import { useQuery } from "@tanstack/react-query";
import { dryingAdvisorService, type DryingAdvisory } from "../services/DryingAdvisorService";
import type { Coords } from "./useGeolocation";

/** Fetch the Enterprise-only palay drying advisory for `coords` (or the
 *  IP-resolved location when null). Server-cached for hours per location/day
 *  (DeepSeek calls cost money), so client staleness mirrors that window.
 *
 *  `enabled` lets the caller gate the request on plan entitlement
 *  (useFeature("drying_advisor")) so non-Enterprise tenants never issue it. */
export function useDryingAdvisory(coords: Coords | null, opts: { enabled?: boolean } = {}) {
  const lat = coords ? Math.round(coords.lat * 100) / 100 : null;
  const lon = coords ? Math.round(coords.lon * 100) / 100 : null;
  return useQuery<DryingAdvisory>({
    queryKey: ["drying-advisory", lat, lon],
    queryFn: () => dryingAdvisorService.get(coords),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: opts.enabled ?? true,
  });
}
