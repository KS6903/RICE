// Rice (bigas) bought in from other mills and traders: the Paddy / Palay page,
// for milled rice. Counted in sacks and priced per sack; no tare and no
// moisture. Each purchase goes straight into milled-rice stock.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingBasket } from "lucide-react";
import { format } from "date-fns";
import { useAccess } from "../hooks/useAccess";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import { paddyService } from "../services/PaddyService";
import { buyingService, type RiceLineForm } from "../services/BuyingService";
import { MILLED_GRADES } from "../mappers/InventoryMapper";
import QuickAdd from "../components/QuickAdd";
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
  inSeveralWarehouses,
  usePurchaseWarehouse,
} from "../components/PurchaseWarehouse";
import { varietyOptions } from "../utils/varieties";
import { t } from "../i18n";

const gradeLabel = (g: string) => g.charAt(0).toUpperCase() + g.slice(1);

const newLine = (): RiceLineForm => ({
  variety_id: "",
  grade_name: "Graded Rice",
  sack_count: "",
  kg_per_sack: "50",
  price_per_sack: "",
});

const lineKg = (l: RiceLineForm) => (Number(l.sack_count) || 0) * (Number(l.kg_per_sack) || 0);
const linePeso = (l: RiceLineForm) => (Number(l.sack_count) || 0) * (Number(l.price_per_sack) || 0);

export default function RicePurchasesPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useOpenOnArrival();

  const { data: purchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ["rice-purchases"],
    queryFn: () => buyingService.listRicePurchases(),
  });
  const { data: varieties = [] } = useQuery({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
  });
  const { data: stock = [], isLoading: stockLoading } = useQuery({
    queryKey: ["rice-stock"],
    queryFn: () => buyingService.listRiceStock(),
  });

  // Which warehouse the rice goes into (owner/admin pick; others: their own).
  const warehouse = usePurchaseWarehouse();
  const stockInSeveralWarehouses = inSeveralWarehouses(stock);

  const [form, setForm] = useState({
    purchase_date: format(new Date(), "yyyy-MM-dd"),
    delivery_type: "delivered",
    remarks: "",
    items: [newLine()],
  });
  const setLine = (idx: number, patch: Partial<RiceLineForm>) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      buyingService.createRicePurchase({ ...body, branch_id: warehouse.branchId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rice-purchases"] });
      qc.invalidateQueries({ queryKey: ["rice-stock"] });
      qc.invalidateQueries({ queryKey: ["milled-rice"] });
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
      setShowForm(false);
      setForm((f) => ({ ...f, remarks: "", items: [newLine()] }));
    },
  });

  const totalKg = form.items.reduce((s, l) => s + lineKg(l), 0);
  const totalPeso = form.items.reduce((s, l) => s + linePeso(l), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {t("Rice (Bigas)")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t("Milled rice you buy, and the rice in stock")}
          </p>
        </div>
      </div>

      <Modal
        open={showForm}
        size="xl"
        title={t("New Rice Purchase")}
        onClose={() => setShowForm(false)}
        testId="new-purchase"
      >
        <div className="space-y-4">
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${warehouse.show ? "lg:grid-cols-3" : ""}`}
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
              <div className="flex items-center gap-3">
                <QuickAdd
                  label={t("New variety")}
                  endpoint="/paddy/varieties"
                  queryKey={["varieties"]}
                  fields={[
                    {
                      key: "code",
                      label: t("Code"),
                      required: true,
                      placeholder: t("e.g. Dinorado"),
                    },
                    { key: "name", label: t("Name"), required: true },
                  ]}
                  transformBody={(b) => ({
                    ...b,
                    code: String(b.code).toUpperCase(),
                    kind: "rice",
                  })}
                />
                <button
                  onClick={() => setForm((f) => ({ ...f, items: [...f.items, newLine()] }))}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {t("+ Add Item")}
                </button>
              </div>
            </div>
            {form.items.map((item, idx) => (
              <div
                key={idx}
                className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg"
              >
                <FieldCaption label={t("Variety")} className="col-span-2 sm:col-span-1">
                  <Select
                    aria-label={t("Variety")}
                    placeholder={t("Variety")}
                    value={item.variety_id}
                    onChange={(v) => setLine(idx, { variety_id: v })}
                    options={varietyOptions(varieties, "rice")}
                  />
                </FieldCaption>
                <FieldCaption label={t("Grade")}>
                  <Select
                    aria-label={t("Grade")}
                    value={item.grade_name}
                    onChange={(v) => setLine(idx, { grade_name: v })}
                    options={MILLED_GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))}
                  />
                </FieldCaption>
                <FieldCaption label={t("Sacks")}>
                  <input
                    className="input"
                    placeholder={t("Sacks")}
                    type="number"
                    min="0"
                    value={item.sack_count}
                    onChange={(e) => setLine(idx, { sack_count: e.target.value })}
                  />
                </FieldCaption>
                <FieldCaption label={t("Kg per sack")}>
                  <input
                    className="input"
                    placeholder="50"
                    type="number"
                    min="0"
                    value={item.kg_per_sack}
                    onChange={(e) => setLine(idx, { kg_per_sack: e.target.value })}
                  />
                </FieldCaption>
                <FieldCaption label={t("Price per sack (₱)")}>
                  <input
                    className="input"
                    placeholder={t("₱/sack")}
                    type="number"
                    min="0"
                    value={item.price_per_sack}
                    onChange={(e) => setLine(idx, { price_per_sack: e.target.value })}
                  />
                </FieldCaption>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <p
              className="mr-auto text-sm text-gray-600 dark:text-slate-300"
              data-testid="rice-total"
            >
              {t("Total:")}{" "}
              <span className="font-semibold tabular-nums">
                {t("{{totalKg}} kg", { totalKg: totalKg.toLocaleString() })}
              </span>
              {" · "}
              <span className="font-semibold tabular-nums">{peso(totalPeso)}</span>
            </p>
            {createMutation.isError && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {t("Couldn't save. Check each line has sacks and a price.")}
              </p>
            )}
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button
              onClick={() => createMutation.mutate(form)}
              className="btn-primary"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? t("Saving…") : t("Save Purchase")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Stock index: what's on hand, always visible above the purchases */}
      <section className="space-y-2" data-testid="rice-stock-index">
        <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">
          {t("Rice in stock")}
        </h3>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {[
                  t("Variety"),
                  t("Grade"),
                  ...(stockInSeveralWarehouses ? [t("Warehouse")] : []),
                  t("Stock (kg)"),
                  t("Sacks (50 kg)"),
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
                  <td className="px-4 py-3">{r.variety?.code || "—"}</td>
                  <td className="px-4 py-3">{r.grade_name ? gradeLabel(r.grade_name) : "—"}</td>
                  {stockInSeveralWarehouses && (
                    <td className="px-4 py-3">{r.branch?.name || t("Unassigned")}</td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    {Number(r.quantity_kg).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">
                    {(Number(r.quantity_kg) / 50).toFixed(1)}
                  </td>
                </tr>
              ))}
              {stockLoading ? (
                <tr>
                  <td colSpan={stockInSeveralWarehouses ? 5 : 4}>
                    <LoadingRows rows={2} />
                  </td>
                </tr>
              ) : (
                stock.length === 0 && (
                  <tr>
                    <td
                      colSpan={stockInSeveralWarehouses ? 5 : 4}
                      className="px-4 py-8 text-center text-muted"
                    >
                      {t(
                        "No rice in stock. Purchases you record and rice you mill show up here by variety and grade.",
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
          kind="rice"
          purchases={purchases}
          loading={purchasesLoading}
          canBuy={canEdit("paddy")}
          onNew={() => setShowForm(true)}
          empty={
            <EmptyState
              icon={ShoppingBasket}
              title={t("No rice bought yet")}
              action={canEdit("paddy") ? t("Record your first purchase") : undefined}
              onAction={() => setShowForm(true)}
              next="Next: sell it from the Sales side."
            >
              {t(
                "Each time you buy milled rice from another mill or a trader, record the sacks and the price here. It's added to your rice stock automatically.",
              )}
            </EmptyState>
          }
        />
        <SaleColumn kind="rice" />
      </div>
    </div>
  );
}
