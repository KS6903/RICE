import type { QueryClient } from "@tanstack/react-query";
import type { User } from "@rice-mill/shared";

let registeredClient: QueryClient | null = null;

/**
 * Register the app QueryClient without coupling the auth store to React's
 * bootstrap module. Returning an unregister callback keeps unit tests isolated.
 */
export function registerSessionQueryClient(client: QueryClient): () => void {
  const previous = registeredClient;
  registeredClient = client;
  return () => {
    if (registeredClient === client) registeredClient = previous;
  };
}

/** Cancel in-flight tenant reads and synchronously remove all cached results. */
export function clearSessionQueryCache(): void {
  const client = registeredClient;
  if (!client) return;
  void client.cancelQueries();
  client.clear();
}

/**
 * Everything that can change which records or capabilities a session may see.
 * Cosmetic profile changes intentionally do not flush the whole application.
 */
export function securityContextFingerprint(user: User | null | undefined): string {
  if (!user) return "anonymous";
  return JSON.stringify({
    id: user.id,
    companyId: user.company_id ?? null,
    branchId: user.branch_id ?? null,
    role: user.role ?? null,
    platformAdmin: !!user.is_platform_admin,
    features: [...(user.features ?? [])].sort(),
  });
}
