// "Branch" and "Store in warehouse" on a purchase form (palay, rice, by-products).
// An owner or admin picks which branch the goods go to; anyone else's purchases
// go to their own branch, and the server enforces the same rule. A branch with
// more than one warehouse asks which one; with a single one there's nothing to ask.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { inventoryService } from "../services/InventoryService";
import { warehousesService, type Warehouse } from "../services/WarehousesService";
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
  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => warehousesService.list(),
  });
  // Until the owner picks, the form shows (and saves to) their own branch,
  // else the main one.
  const defaultBranch = useMemo(
    () =>
      (
        branches.find((b) => b.id === user?.branch_id) ??
        branches.find((b) => b.is_main_branch) ??
        branches[0]
      )?.id ?? "",
    [branches, user?.branch_id],
  );
  const [pickedBranch, setPickedBranch] = useState("");
  const [pickedWarehouse, setPickedWarehouse] = useState("");
  const branchValue = pickedBranch || defaultBranch;
  const inBranch = canPick ? branchValue : (user?.branch_id ?? "");
  const here = useMemo(
    () => warehouses.filter((w) => w.branch_id === inBranch),
    [warehouses, inBranch],
  );
  const warehouseValue = here.some((w) => w.id === pickedWarehouse)
    ? pickedWarehouse
    : ((here.find((w) => w.is_default) ?? here[0])?.id ?? "");
  const showBranch = canPick && branches.length > 1;
  const showWarehouse = here.length > 1;
  return {
    branches,
    branchValue,
    setBranch: (id: string) => {
      setPickedBranch(id);
      setPickedWarehouse("");
    },
    warehouses: here,
    warehouseValue,
    setWarehouse: setPickedWarehouse,
    /** Whether to show the Branch dropdown at all. */
    showBranch,
    /** Whether to show the Warehouse dropdown: the branch has more than one. */
    showWarehouse,
    /** How many of the two fields show, for the form's grid. */
    fields: Number(showBranch) + Number(showWarehouse),
    /** What to send as the purchase's branch_id: null means "the recorder's own". */
    branchId: canPick ? branchValue || null : null,
    /** What to send as its warehouse_id: null means "the branch's first". */
    warehouseId: showWarehouse ? warehouseValue || null : null,
  };
}

/** The columns a purchase form's first row needs for these two fields. */
export const purchaseGridClass = (fields: number) =>
  fields >= 2 ? "lg:grid-cols-4" : fields === 1 ? "lg:grid-cols-3" : "";

export function PurchaseWarehouseField({
  warehouse,
}: {
  warehouse: ReturnType<typeof usePurchaseWarehouse>;
}) {
  return (
    <>
      {warehouse.showBranch && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
            {t("Branch")}
          </label>
          <Select
            aria-label={t("Branch")}
            value={warehouse.branchValue}
            onChange={warehouse.setBranch}
            options={warehouse.branches.map((b: any) => ({
              value: b.id,
              label: `${b.name}${b.is_main_branch ? t(" (Main)") : ""}`,
            }))}
          />
        </div>
      )}
      {warehouse.showWarehouse && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
            {t("Store in warehouse")}
          </label>
          <Select
            aria-label={t("Store in warehouse")}
            value={warehouse.warehouseValue}
            onChange={warehouse.setWarehouse}
            options={warehouse.warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </div>
      )}
    </>
  );
}

/** Whether these rows (stock lines, purchases) are spread over more than one branch. */
export const inSeveralBranches = (rows: { branch_id?: string | null }[]): boolean =>
  new Set(rows.map((r) => r.branch_id ?? "")).size > 1;

/** Whether some branch's rows sit in more than one of its warehouses: only then
 *  does the warehouse earn a column (one warehouse per branch says nothing the
 *  branch doesn't). */
export const inSeveralWarehouses = (
  rows: { branch_id?: string | null; warehouse_id?: string | null }[],
): boolean => {
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = r.branch_id ?? "";
    seen.set(key, (seen.get(key) ?? new Set()).add(r.warehouse_id ?? ""));
  }
  return [...seen.values()].some((set) => set.size > 1);
};
