// Rice (bigas) bought in from other mills and traders: the Paddy / Palay page,
// for milled rice. Counted in sacks and priced per sack; no tare and no
// moisture. Each purchase goes straight into milled-rice stock.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ShoppingBasket } from "lucide-react";
import { format } from "date-fns";
import { useAccess } from "../hooks/useAccess";
import { useIsPhone } from "../hooks/useIsPhone";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import { useRiceSackSize } from "../hooks/useRiceSackSize";
import { paddyService } from "../services/PaddyService";
import {
  buyingService,
  lineReady,
  riceLineProblems,
  type RiceLineForm,
} from "../services/BuyingService";
import { MILLED_GRADES } from "../mappers/InventoryMapper";
import QuickAdd from "../components/QuickAdd";
import EmptyState from "../components/EmptyState";
import LoadingRows from "../components/LoadingRows";
import FieldCaption from "../components/FieldCaption";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import ProfitLink from "../components/buying/ProfitLink";
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
import { fixFields, needsChoice, needsInput } from "../utils/required";
import { STOCK_CELL as CELL, STOCK_FIGURE as FIGURE, stockDetails } from "../utils/stockTable";
import { varietyOptions } from "../utils/varieties";
import { t } from "../i18n";

const gradeLabel = (g: string) => g.charAt(0).toUpperCase() + g.slice(1);

const newLine = (): RiceLineForm => ({
  variety_id: "",
  grade_name: "",
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

  // Which branch and warehouse the rice goes into (owner/admin pick the branch;
  // others: their own).
  const warehouse = usePurchaseWarehouse();
  const stockInSeveralBranches = inSeveralBranches(stock);
  const stockInSeveralWarehouses = inSeveralWarehouses(stock);
  const placeColumns = Number(stockInSeveralBranches) + Number(stockInSeveralWarehouses);
  const sack = useRiceSackSize();
  // A phone has room for three columns: the grade, and the branch and warehouse when
  // there are several, go in small print under the variety.
  const phone = useIsPhone();
  const stockColumns = phone ? 3 : 4 + placeColumns;

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

  // After a try at saving with something missing, the empty fields say so.
  const [attempted, setAttempted] = useState(false);
  const closeForm = () => {
    setShowForm(false);
    setAttempted(false);
  };

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      buyingService.createRicePurchase({
        ...body,
        branch_id: warehouse.branchId,
        warehouse_id: warehouse.warehouseId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rice-purchases"] });
      qc.invalidateQueries({ queryKey: ["rice-stock"] });
      qc.invalidateQueries({ queryKey: ["milled-rice"] });
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
      closeForm();
      setForm((f) => ({ ...f, remarks: "", items: [newLine()] }));
    },
  });

  // Each line needs its grade, the sacks and their weight, and a price.
  const ready = form.items.every((l) => lineReady(riceLineProblems(l)));
  const submit = () => {
    setAttempted(true);
    if (ready) createMutation.mutate(form);
  };

  const totalKg = form.items.reduce((s, l) => s + lineKg(l), 0);
  const totalPeso = form.items.reduce((s, l) => s + linePeso(l), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {t("Rice (Bigas)")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t("Milled rice you buy, and the rice in stock")}
          </p>
        </div>
        <ProfitLink />
      </div>

      <Modal
        open={showForm}
        size="xl"
        title={t("New Rice Purchase")}
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
            {form.items.map((item, idx) => {
              const problems = riceLineProblems(item);
              const flag = (missing: boolean, message = needsInput()) =>
                attempted && missing ? message : undefined;
              return (
                <div
                  key={idx}
                  className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 ring-1 ring-soft sm:grid-cols-5 dark:bg-slate-900/50"
                >
                  <FieldCaption label={t("Variety")} className="col-span-2 sm:col-span-1">
                    <Select
                      aria-label={t("Variety")}
                      value={item.variety_id}
                      onChange={(v) => setLine(idx, { variety_id: v })}
                      options={varietyOptions(varieties, "rice")}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Grade")} error={flag(problems.grade, needsChoice())}>
                    <Select
                      aria-label={t("Grade")}
                      value={item.grade_name}
                      onChange={(v) => setLine(idx, { grade_name: v })}
                      options={MILLED_GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Sacks")} error={flag(problems.sacks)}>
                    <input
                      className="input"
                      placeholder={t("Sacks")}
                      type="number"
                      min="0"
                      value={item.sack_count}
                      onChange={(e) => setLine(idx, { sack_count: e.target.value })}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Kg per sack")} error={flag(problems.kgPerSack)}>
                    <input
                      className="input"
                      placeholder="50"
                      type="number"
                      min="0"
                      value={item.kg_per_sack}
                      onChange={(e) => setLine(idx, { kg_per_sack: e.target.value })}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Price per sack (₱)")} error={flag(problems.price)}>
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
              );
            })}
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
            {attempted && !ready && (
              <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
                {fixFields()}
              </p>
            )}
            {createMutation.isError && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {t("Couldn't save. Check each line has sacks and a price.")}
              </p>
            )}
            <button onClick={closeForm} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button onClick={submit} className="btn-primary" disabled={createMutation.isPending}>
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
        {/* A card that is still too narrow scrolls sideways, not cuts a column off. */}
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {[
                  t("Variety"),
                  ...(phone
                    ? []
                    : [
                        t("Grade"),
                        ...(stockInSeveralBranches ? [t("Branch")] : []),
                        ...(stockInSeveralWarehouses ? [t("Warehouse")] : []),
                      ]),
                  t("Stock (kg)"),
                ].map((h) => (
                  <th
                    key={h}
                    className={`${CELL} text-left font-medium text-gray-600 dark:text-slate-300`}
                  >
                    {h}
                  </th>
                ))}
                <th className={`${CELL} text-left font-medium text-gray-600 dark:text-slate-300`}>
                  {/* Tapping it counts the stock in the other size of sack. Its ring
                      pulses until it has been tried once. A finger gets a 44px target. */}
                  <button
                    type="button"
                    className="-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-left font-medium hover:bg-gray-200/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 dark:hover:bg-slate-700/60 [@media(pointer:coarse)]:min-h-[44px]"
                    title={t("Tap to count in {{kg}} kg sacks", { kg: sack.other })}
                    onClick={sack.toggle}
                  >
                    {t("Sacks ({{kg}} kg)", { kg: sack.kg })}
                    <span
                      aria-hidden="true"
                      className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center"
                    >
                      {!sack.tapped && (
                        <span
                          data-testid="sack-pulse"
                          className="absolute inset-0 rounded-full bg-emerald-500/40 motion-safe:animate-ping"
                        />
                      )}
                      <ArrowLeftRight
                        size={14}
                        className="relative text-emerald-600 dark:text-emerald-400"
                      />
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {stock.map((r: any) => {
                const under = stockDetails(
                  r.grade_name && gradeLabel(r.grade_name),
                  stockInSeveralBranches && (r.branch?.name || t("Unassigned")),
                  stockInSeveralWarehouses && r.warehouse?.name,
                );
                return (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                    <td className={CELL}>
                      {r.variety?.code || "—"}
                      {phone && under && (
                        <span className="mt-0.5 block max-w-[12rem] text-xs text-muted">
                          {under}
                        </span>
                      )}
                    </td>
                    {!phone && (
                      <>
                        <td className={CELL}>{r.grade_name ? gradeLabel(r.grade_name) : "—"}</td>
                        {stockInSeveralBranches && (
                          <td className={CELL}>{r.branch?.name || t("Unassigned")}</td>
                        )}
                        {stockInSeveralWarehouses && (
                          <td className={CELL}>{r.warehouse?.name || "—"}</td>
                        )}
                      </>
                    )}
                    <td className={`${FIGURE} font-medium`}>
                      {Number(r.quantity_kg).toLocaleString()}
                    </td>
                    <td className={`${FIGURE} text-gray-500 dark:text-slate-400`}>
                      {(Number(r.quantity_kg) / sack.kg).toFixed(1)}
                    </td>
                  </tr>
                );
              })}
              {stockLoading ? (
                <tr>
                  <td colSpan={stockColumns}>
                    <LoadingRows rows={2} />
                  </td>
                </tr>
              ) : (
                stock.length === 0 && (
                  <tr>
                    <td colSpan={stockColumns} className="px-4 py-8 text-center text-muted">
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
