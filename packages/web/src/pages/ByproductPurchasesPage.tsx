// By-products bought in (ipa, darak, binlid): the Paddy / Palay page for
// by-products. Weighed and priced per kg; no variety, grade, tare or moisture.
// Each purchase goes straight into by-product stock.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { format } from "date-fns";
import { useAccess } from "../hooks/useAccess";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import {
  buyingService,
  byproductLineProblems,
  lineReady,
  type ByproductLineForm,
} from "../services/BuyingService";
import { byproductLabel } from "../mappers/byproductNames";
import { useByproductKinds } from "../hooks/useByproductKinds";
import EmptyState from "../components/EmptyState";
import LoadingRows from "../components/LoadingRows";
import FieldCaption from "../components/FieldCaption";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import PurchaseColumn from "../components/buying/PurchaseColumn";
import SaleColumn from "../components/buying/SaleColumn";
import { peso } from "../components/buying/money";
import {
  PurchaseWarehouseField,
  inSeveralBranches,
  inSeveralWarehouses,
  purchaseGridClass,
  usePurchaseWarehouse,
} from "../components/PurchaseWarehouse";
import { fixFields, needsInput } from "../utils/required";
import { t } from "../i18n";

const newLine = (): ByproductLineForm => ({
  byproduct_type: "ipa",
  weight_kg: "",
  price_per_kg: "",
});

const linePeso = (l: ByproductLineForm) =>
  (Number(l.weight_kg) || 0) * (Number(l.price_per_kg) || 0);

export default function ByproductPurchasesPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useOpenOnArrival();

  const { data: purchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ["byproduct-purchases"],
    queryFn: () => buyingService.listByproductPurchases(),
  });
  const { data: stock = [], isLoading: stockLoading } = useQuery({
    queryKey: ["byproduct-stock"],
    queryFn: () => buyingService.listByproductStock(),
  });

  // Which branch and warehouse it goes into (owner/admin pick the branch;
  // others: their own).
  const warehouse = usePurchaseWarehouse();
  const stockInSeveralBranches = inSeveralBranches(stock);
  const stockInSeveralWarehouses = inSeveralWarehouses(stock);
  const placeColumns = Number(stockInSeveralBranches) + Number(stockInSeveralWarehouses);

  // The mill's by-products (Stock > Catalog), plus any other it already stocks.
  const { active: kinds } = useByproductKinds();
  const types = useMemo(() => {
    const all = new Set([...kinds.map((k) => k.code), ...stock.map((r: any) => r.byproduct_type)]);
    return [...all].map((t) => ({ value: t, label: byproductLabel(t) }));
  }, [kinds, stock]);

  const [form, setForm] = useState({
    purchase_date: format(new Date(), "yyyy-MM-dd"),
    delivery_type: "delivered",
    remarks: "",
    items: [newLine()],
  });
  const setLine = (idx: number, patch: Partial<ByproductLineForm>) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));

  // After a try at saving with something missing, the empty fields say so.
  const [attempted, setAttempted] = useState(false);
  const closeForm = () => {
    setShowForm(false);
    setAttempted(false);
  };

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      buyingService.createByproductPurchase({
        ...body,
        branch_id: warehouse.branchId,
        warehouse_id: warehouse.warehouseId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["byproduct-purchases"] });
      qc.invalidateQueries({ queryKey: ["byproduct-stock"] });
      qc.invalidateQueries({ queryKey: ["byproducts"] });
      qc.invalidateQueries({ queryKey: ["byproduct-kinds"] });
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
      closeForm();
      setForm((f) => ({ ...f, remarks: "", items: [newLine()] }));
    },
  });

  // Each line needs what it is, its weight and a price.
  const ready = form.items.every((l) => lineReady(byproductLineProblems(l)));
  const submit = () => {
    setAttempted(true);
    if (ready) createMutation.mutate(form);
  };

  const totalKg = form.items.reduce((s, l) => s + (Number(l.weight_kg) || 0), 0);
  const totalPeso = form.items.reduce((s, l) => s + linePeso(l), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {t("By-products")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t("Ipa, darak and binlid you buy, and what's in stock")}
          </p>
        </div>
      </div>

      <Modal
        open={showForm}
        size="xl"
        title={t("New By-product Purchase")}
        onClose={closeForm}
        testId="new-purchase"
      >
        <div className="space-y-4">
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${purchaseGridClass(warehouse.fields)}`}
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Purchase Date")}
              </label>
              <DatePicker
                aria-label={t("Purchase date")}
                value={form.purchase_date}
                onChange={(v) => setForm((f) => ({ ...f, purchase_date: v }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                {t("Delivery Type")}
              </label>
              <Select
                aria-label={t("Delivery type")}
                value={form.delivery_type}
                onChange={(v) => setForm((f) => ({ ...f, delivery_type: v }))}
                options={[
                  { value: "delivered", label: t("Delivered") },
                  { value: "picked_up", label: t("Picked up") },
                ]}
              />
            </div>
            <PurchaseWarehouseField warehouse={warehouse} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-slate-200">
                {t("Purchase Items")}
              </p>
              <button
                onClick={() => setForm((f) => ({ ...f, items: [...f.items, newLine()] }))}
                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                {t("+ Add Item")}
              </button>
            </div>
            {form.items.map((item, idx) => {
              const problems = byproductLineProblems(item);
              const flag = (missing: boolean) => (attempted && missing ? needsInput() : undefined);
              return (
                <div
                  key={idx}
                  className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 ring-1 ring-soft sm:grid-cols-3 dark:bg-slate-900/50"
                >
                  <FieldCaption label={t("By-product")} className="col-span-2 sm:col-span-1">
                    <Select
                      aria-label={t("By-product")}
                      value={item.byproduct_type}
                      onChange={(v) => setLine(idx, { byproduct_type: v })}
                      options={types}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Weight (kg)")} error={flag(problems.weight)}>
                    <input
                      className="input"
                      placeholder="kg"
                      type="number"
                      min="0"
                      value={item.weight_kg}
                      onChange={(e) => setLine(idx, { weight_kg: e.target.value })}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Price per kg (₱)")} error={flag(problems.price)}>
                    <input
                      className="input"
                      placeholder={t("₱/kg")}
                      type="number"
                      min="0"
                      value={item.price_per_kg}
                      onChange={(e) => setLine(idx, { price_per_kg: e.target.value })}
                    />
                  </FieldCaption>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <p
              className="w-full text-sm text-gray-600 dark:text-slate-300 sm:mr-auto sm:w-auto"
              data-testid="byproduct-total"
            >
              {t("Total:")}{" "}
              <span className="font-semibold tabular-nums">
                {t("{{totalKg}} kg", { totalKg: totalKg.toLocaleString() })}
              </span>
              {" · "}
              <span className="font-semibold tabular-nums">{peso(totalPeso)}</span>
            </p>
            {attempted && !ready && (
              <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
                {fixFields()}
              </p>
            )}
            {createMutation.isError && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {t("Couldn't save. Check each line has a weight and a price.")}
              </p>
            )}
            <button onClick={closeForm} className="btn-secondary flex-auto sm:flex-none">
              {t("Cancel")}
            </button>
            <button
              onClick={submit}
              className="btn-primary flex-auto sm:flex-none"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? t("Saving…") : t("Save Purchase")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Stock index: what's on hand, always visible above the purchases */}
      <section className="space-y-2" data-testid="byproduct-stock-index">
        <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">
          {t("By-products in stock")}
        </h3>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {[
                  t("By-product"),
                  ...(stockInSeveralBranches ? [t("Branch")] : []),
                  ...(stockInSeveralWarehouses ? [t("Warehouse")] : []),
                  t("Stock (kg)"),
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {stock.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3">{byproductLabel(r.byproduct_type)}</td>
                  {stockInSeveralBranches && (
                    <td className="px-4 py-3">{r.branch?.name || t("Unassigned")}</td>
                  )}
                  {stockInSeveralWarehouses && (
                    <td className="px-4 py-3">{r.warehouse?.name || "—"}</td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    {Number(r.quantity_kg).toLocaleString()}
                  </td>
                </tr>
              ))}
              {stockLoading ? (
                <tr>
                  <td colSpan={2 + placeColumns}>
                    <LoadingRows rows={2} />
                  </td>
                </tr>
              ) : (
                stock.length === 0 && (
                  <tr>
                    <td colSpan={2 + placeColumns} className="px-4 py-8 text-center text-muted">
                      {t(
                        "No by-products in stock. What you buy and what milling leaves over show up here.",
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bought on the left, sold on the right; each row opens its details */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <PurchaseColumn
          kind="byproduct"
          purchases={purchases}
          loading={purchasesLoading}
          canBuy={canEdit("paddy")}
          onNew={() => setShowForm(true)}
          empty={
            <EmptyState
              icon={Boxes}
              title={t("No by-products bought yet")}
              action={canEdit("paddy") ? t("Record your first purchase") : undefined}
              onAction={() => setShowForm(true)}
              next="Next: sell it from the Sales side."
            >
              {t(
                "Each time you buy ipa, darak or binlid, record the weight and the price here. It's added to your by-product stock automatically.",
              )}
            </EmptyState>
          }
        />
        <SaleColumn kind="byproduct" />
      </div>
    </div>
  );
}
