import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { locationsService } from "../services/LocationsService";

export type SavedLocation = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  region: string | null;
  is_default: boolean;
  created_at: string | null;
};

export type GeocodeHit = {
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  region: string | null;
};

/** React Query bindings for the saved-location endpoints. All mutations
 *  invalidate the list so the dropdown updates immediately. */
export function useLocations() {
  const qc = useQueryClient();

  const list = useQuery<SavedLocation[]>({
    queryKey: ["user-locations"],
    queryFn: () => locationsService.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const create = useMutation({
    mutationFn: (body: Omit<SavedLocation, "id" | "is_default" | "created_at"> & { is_default?: boolean }) =>
      locationsService.create(body) as Promise<SavedLocation>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-locations"] });
      qc.invalidateQueries({ queryKey: ["weather"] });
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => locationsService.setDefault(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-locations"] });
      qc.invalidateQueries({ queryKey: ["weather"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => locationsService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-locations"] });
      qc.invalidateQueries({ queryKey: ["weather"] });
    },
  });

  return { list, create, setDefault, remove };
}

/** Debounced geocoding search. Returns `null` while idle and a query result
 *  while there's a non-empty query. */
export function useGeocodeSearch(query: string) {
  const q = query.trim();
  return useQuery<GeocodeHit[]>({
    queryKey: ["geocode-search", q],
    queryFn: () => locationsService.search(q),
    enabled: q.length >= 2,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}
