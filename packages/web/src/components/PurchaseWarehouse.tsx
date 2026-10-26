// "Store in warehouse" on a purchase form (palay, rice, by-products). An owner
// or admin picks which warehouse the goods go into; anyone else's purchases go
// to their own warehouse, and the server enforces the same rule.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { inventoryService } from "../services/InventoryService";
import { useAuthStore } from "../stores/authStore";
import Select from "./Select";
import { t } from "../i18n";

export function usePurchaseWarehouse() {
  const user = useAuthStore((s) => s.user);
  const canPick = user?.role === "owner" || user?.role === "admin";
  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["branches"],
    queryFn: () => inventoryService.getBranches(),
    enabled: canPick,
  });
  // Until the owner picks, the form shows (and saves to) their own warehouse,
  // else the main one.
  const defaultId = useMemo(
    () =>
      (
        branches.find((b) => b.id === user?.branch_id) ??
        branches.find((b) => b.is_main_branch) ??
        branches[0]
      )?.id ?? "",
    [branches, user?.branch_id],
  );
  const [picked, setPicked] = useState("");
  const value = picked || defaultId;
  return {
    branches,
    value,
    setValue: setPicked,
    /** Whether to show the dropdown at all. */
    show: canPick && branches.length > 0,
    /** What to send as the purchase's branch_id: null means "the recorder's own". */
    branchId: canPick ? value || null : null,
  };
}

export function PurchaseWarehouseField({
  warehouse,
}: {
  warehouse: ReturnType<typeof usePurchaseWarehouse>;
}) {
  if (!warehouse.show) return null;
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
        {t("Store in warehouse")}
      </label>
      <Select
        aria-label={t("Store in warehouse")}
        value={warehouse.value}
        onChange={warehouse.setValue}
        options={warehouse.branches.map((b: any) => ({
          value: b.id,
          label: `${b.name}${b.is_main_branch ? t(" (Main)") : ""}`,
        }))}
      />
    </div>
  );
}

/** The warehouse column only earns its place once rows sit in more than one. */
export const inSeveralWarehouses = (rows: { branch_id?: string | null }[]): boolean =>
  new Set(rows.map((r) => r.branch_id ?? "")).size > 1;
