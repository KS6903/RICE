import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { byproductKindService, type ByproductKind } from "../services/ByproductKindService";
import { BYPRODUCT_NAMES, byproductLabel, keepByproductNames } from "../mappers/byproductNames";

/** Until the list loads, or if it can't, the three every mill has. */
const BUILT_IN: ByproductKind[] = Object.entries(BYPRODUCT_NAMES).map(([code, name]) => ({
  id: null,
  code,
  name,
  built_in: true,
  is_active: true,
}));

/** The mill's by-products: `all` for the Catalog, `active` (not hidden) for
 *  the pickers, and `label`, a code's name, which changes when the names
 *  arrive, so a page can work out again what it shows with them. Loading them
 *  also gives byproductLabel() the names the Boss chose. */
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
  const label = useMemo(() => {
    const names = Object.fromEntries((query.data ?? []).map((k) => [k.code, k.name]));
    return (code: string): string => names[code] ?? byproductLabel(code);
  }, [query.data]);
  const all = query.data ?? BUILT_IN;
  return { all, active: all.filter((k) => k.is_active), label, isLoading: query.isLoading };
}
