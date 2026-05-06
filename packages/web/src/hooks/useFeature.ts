import { useAuthStore } from "../stores/authStore";

/**
 * Returns true if the current user's plan includes the given feature code.
 * Platform admins always return true (they bypass the gate).
 */
export function useFeature(code: string): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  if (user.is_platform_admin) return true;
  const features = (user as any).features as string[] | undefined;
  if (!features) return false;
  if (features.includes("*")) return true;
  return features.includes(code);
}

export function useCurrentPlan() {
  const user = useAuthStore((s) => s.user);
  return (user as any)?.subscription as {
    code: string;
    name: string;
    monthly_price: number;
    max_users: number | null;
    max_branches: number | null;
    status: string;
    expires_at: string | null;
  } | null;
}
