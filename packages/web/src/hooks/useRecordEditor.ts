import { useAuthStore } from "../stores/authStore";

/**
 * Whether this person can correct saved records: edit an order, an invoice or
 * any other record already entered. The Boss can. Mirrors the API's
 * can_edit_saved_records; every such edit is logged, field by field.
 */
export function useCanEditSavedRecords(): boolean {
  return useAuthStore((s) => s.user?.role === "owner");
}
