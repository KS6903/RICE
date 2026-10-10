import type { User } from "@rice-mill/shared";
import { useAuthStore } from "../stores/authStore";

/**
 * Returns true if the current user's plan includes the given feature code.
 * Platform admins always return true (they bypass the gate).
 */
export function useFeature(code: string): boolean {
  const user = useAuthStore((s) => s.user);
  return planHas(user, code);
}

/** The same check outside a hook, for lists that test several codes at once. */
export function planHas(user: User | null | undefined, code: string): boolean {
  if (!user) return false;
  if (user.is_platform_admin) return true;
  const features = user.features;
  if (!features) return false;
  if (features.includes("*")) return true;
  return features.includes(code);
}

export function useCurrentPlan() {
  const user = useAuthStore((s) => s.user);
  return user?.subscription ?? null;
}
