import { useQuery } from "@tanstack/react-query";
import { byproductKindService, type ByproductKind } from "../services/ByproductKindService";
import { BYPRODUCT_NAMES, keepByproductNames } from "../mappers/byproductNames";

/** Until the list loads, or if it can't, the three every mill has. */
const BUILT_IN: ByproductKind[] = Object.entries(BYPRODUCT_NAMES).map(([code, name]) => ({
  id: null,
  code,
  name,
  built_in: true,
  is_active: true,
}));

/** The mill's by-products: `all` for the Catalog, `active` (not hidden) for
 *  the pickers. Loading them also gives byproductLabel() the names the Boss
 *  chose, and a page that calls this draws again when they arrive. */
export function useByproductKinds() {
  const query = useQuery({
    queryKey: ["byproduct-kinds"],
    queryFn: async () => {
      const kinds = await byproductKindService.list();
      keepByproductNames(kinds);
      return kinds;
    },
    staleTime: 5 * 60_000,
  });
  const all = query.data ?? BUILT_IN;
  return { all, active: all.filter((k) => k.is_active), isLoading: query.isLoading };
}
