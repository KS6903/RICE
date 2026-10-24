import { useAuthStore } from "../stores/authStore";

/**
 * Whether this person can correct saved records: edit an order, an invoice or
 * any other record already entered. The Boss can, and so can any role the Boss
 * gave edit power on the Users page (the profile's edit_power, worked out by
 * the API). Every such edit is logged, field by field.
 */
export function useCanEditSavedRecords(): boolean {
  return useAuthStore((s) => s.user?.edit_power ?? s.user?.role === "owner");
}
