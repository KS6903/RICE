import { QueryClient, hashKey, type Query, type QueryKey } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";
import { registerSessionQueryClient, securityContextFingerprint } from "./sessionCache";

/**
 * Scope every cached query to the current account/security context. Existing
 * query keys remain usable for partial invalidation, while their underlying
 * hashes can never collide across tenants or users.
 */
export function sessionQueryKeyHash(queryKey: QueryKey): string {
  const scope = securityContextFingerprint(useAuthStore.getState().user);
  return hashKey(["session", scope, queryKey]);
}

/** How long a query's data counts as fresh unless it sets its own staleTime.
 *  Stale results remain visible while the query refreshes in the background. */
export const DEFAULT_STALE_TIME = 1000 * 60 * 5;
/** Keep visited pages' data ready when someone comes back to them. */
export const SESSION_CACHE_TIME = 1000 * 60 * 30;

/** A page's own data (the default freshness) refetches each time the page is
 *  opened, even while still fresh: pages change in place, so a sale recorded on
 *  one page must show on the next. The cached copy draws at once meanwhile.
 *  Queries with their own staleTime (weather, places, the session) keep it. */
const refetchPageDataOnMount = (query: Query): boolean | "always" =>
  (query.options as { staleTime?: unknown }).staleTime === DEFAULT_STALE_TIME ? "always" : true;

export function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME,
        gcTime: SESSION_CACHE_TIME,
        refetchOnMount: refetchPageDataOnMount,
        retry: 1,
        queryKeyHashFn: sessionQueryKeyHash,
      },
    },
  });
}

export const queryClient = createSessionQueryClient();
registerSessionQueryClient(queryClient);
