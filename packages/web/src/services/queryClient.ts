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
 *  Opening a page refreshes the queries on this default (PageLoadingBar). */
export const DEFAULT_STALE_TIME = 1000 * 60 * 5;

export function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME,
        retry: 1,
        queryKeyHashFn: sessionQueryKeyHash,
      },
    },
  });
}

export const queryClient = createSessionQueryClient();
registerSessionQueryClient(queryClient);
