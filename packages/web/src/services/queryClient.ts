import { QueryClient, hashKey, type QueryKey } from "@tanstack/react-query";
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

export function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME,
        gcTime: SESSION_CACHE_TIME,
        retry: 1,
        queryKeyHashFn: sessionQueryKeyHash,
      },
    },
  });
}

export const queryClient = createSessionQueryClient();
registerSessionQueryClient(queryClient);
