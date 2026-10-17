import { useAuthStore } from "../stores/authStore";
import { accessLevel, type AppSection, type AccessLevel } from "@rice-mill/shared";

const LEVELS: readonly AccessLevel[] = ["full", "view", "none"];

/**
 * Role-based access for the current user.
 *
 * Mirrors useFeature (which gates by subscription plan); this gates by *role*.
 * A section is shown only when both pass. Platform admins bypass role limits.
 *
 * What the server says this person can open (`user.access`) wins: it carries the
 * changes their mill's Boss has made to the role matrix. The shared matrix is the
 * fallback, for a server that doesn't send it.
 */
export function useAccess() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user?.is_platform_admin;
  const role = user?.role ?? null;

  const level = (section: AppSection): AccessLevel => {
    if (isAdmin) return "full";
    const told = user?.access?.[section];
    return told && LEVELS.includes(told) ? told : accessLevel(role, section);
  };

  return {
    role,
    level,
    canView: (section: AppSection) => level(section) !== "none",
    canEdit: (section: AppSection) => level(section) === "full",
    /** Read-only = visible but not editable. Handy for "view badge" + disabled actions. */
    isReadOnly: (section: AppSection) => level(section) === "view",
  };
}
