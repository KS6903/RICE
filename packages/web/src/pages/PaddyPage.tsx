import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  paddyService,
  blankPurchaseItem,
  pricePerCavan,
  type PurchaseItemForm,
  type StockView,
} from "../services/PaddyService";
import { Container, LayoutGrid, Scale, ShoppingBag, Wheat, type LucideIcon } from "lucide-react";
import { format } from "date-fns";
import QuickAdd from "../components/QuickAdd";
import { useAccess } from "../hooks/useAccess";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import EmptyState from "../components/EmptyState";
import LoadingRows from "../components/LoadingRows";
import FieldCaption from "../components/FieldCaption";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import PurchaseColumn from "../components/buying/PurchaseColumn";
import SaleColumn from "../components/buying/SaleColumn";
import WetDryChoice from "../components/buying/WetDryChoice";
import {
  PurchaseWarehouseField,
  inSeveralWarehouses,
  usePurchaseWarehouse,
} from "../components/PurchaseWarehouse";
import { varietyOptions } from "../utils/varieties";
import { t } from "../i18n";

type Unit = Exclude<StockView, "all">;

/** The picture on each way of viewing the stock, like a grid / list switch. */
const viewIcons: Record<StockView, LucideIcon> = {
  all: LayoutGrid,
  sacks: ShoppingBag,
  cavans: Container,
  kilos: Scale,
};

/** A figure for the stock table, to a decimal; a dash when the server sent none. */
const amount = (v: unknown) =>
  v == null || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** The price per cavan worked out from a price per kilo, for the read-only field. */
const cavanPrice = (pricePerKg: string) => {
  const price = pricePerCavan(pricePerKg);
  return price === null ? "" : price.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

export default function PaddyPage() {
  const qc = useQueryClient();
  const { canEdit, role } = useAccess();
  const [showForm, setShowForm] = useOpenOnArrival();

  const { data: purchases = [], isLoading: purchasesLoading } = useQuery({
    queryKey: ["palay-purchases"],
    queryFn: () => paddyService.listPurchases(),
  });
  const { data: varieties = [] } = useQuery({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
  });
  const { data: grades = [] } = useQuery({
    queryKey: ["grades"],
    queryFn: () => paddyService.listGrades(),
  });
  const { data: inventory = [], isLoading: inventoryLoading } = useQuery({
    queryKey: ["palay-inventory"],
    queryFn: () => paddyService.listInventory(),
  });
  const { data: stockView = "all" } = useQuery<StockView>({
    queryKey: ["palay-stock-view"],
    queryFn: () => paddyService.getStockView(),
  });
  const chooseView = useMutation({
    mutationFn: (view: StockView) => paddyService.setStockView(view),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["palay-stock-view"] }),
  });

  // Which warehouse the palay goes into (owner/admin pick; others: their own).
  const warehouse = usePurchaseWarehouse();
  // The stock table names the warehouse once stock sits in more than one.
  const stockInSeveralWarehouses = inSeveralWarehouses(inventory);

  const [form, setForm] = useState({
    purchase_date: format(new Date(), "yyyy-MM-dd"),
    delivery_type: "delivered",
    remarks: "",
    items: [blankPurchaseItem()],
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      paddyService.createPurchase({ ...body, branch_id: warehouse.branchId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["palay-purchases"] });
      qc.invalidateQueries({ queryKey: ["palay-inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
      setShowForm(false);
    },
  });

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, blankPurchaseItem()] }));
  const setItem = (idx: number, patch: Partial<PurchaseItemForm>) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  const text =
    (idx: number, key: Exclude<keyof PurchaseItemForm, "is_wet">) =>
    (e: { target: { value: string } }) =>
      setItem(idx, { [key]: e.target.value } as Partial<PurchaseItemForm>);

  // A line needs something counted (sacks, cavans or kilos; the last two are
  // optional estimates) and a price; a wet line also its weight and moisture
  // after drying.
  const ready = form.items.every(
    (i) =>
      (i.sack_count || i.cavan_count || i.gross_weight_kg) &&
      i.price_per_kg !== "" &&
      (!i.is_wet || (Number(i.dried_weight_kg) > 0 && i.dried_moisture_pct !== "")),
  );
  const saveError = (createMutation.error as any)?.response?.data?.detail;

  // How the stock is counted: the Boss picks sacks, cavans, kilos or all. "All" is
  // too wide for a phone, which shows the sacks.
  const units: Record<Unit, { label: string; word: string; stock: string; wet: string }> = {
    sacks: {
      label: t("Sacks"),
      word: t("sacks"),
      stock: "quantity_sacks",
      wet: "wet_sacks",
    },
    cavans: {
      label: t("Cavans (est.)"),
      word: t("cavans"),
      stock: "quantity_cavans",
      wet: "wet_cavans",
    },
    kilos: { label: t("Kilos (est.)"), word: t("kg"), stock: "quantity_kg", wet: "wet_kg" },
  };
  // "All" leaves out the cavans while they read the same as the sacks on every row
  // (sacks of 50 kg): the column would only repeat itself.
  const cavansRepeatSacks =
    inventory.length > 0 &&
    inventory.every(
      (i: any) =>
        i.quantity_sacks != null && amount(i.quantity_sacks) === amount(i.quantity_cavans),
    );
  const shownUnits: Unit[] =
    stockView === "all"
      ? cavansRepeatSacks
        ? ["sacks", "kilos"]
        : ["sacks", "cavans", "kilos"]
      : [stockView];
  const unitClass = (u: Unit) =>
    stockView === "all" && u !== "sacks" ? "hidden sm:table-cell" : "";
  const stockColumns = 2 + (stockInSeveralWarehouses ? 1 : 0) + shownUnits.length;
  const viewOptions: { value: StockView; label: string }[] = [
    { value: "all", label: t("All") },
    { value: "sacks", label: t("Sacks") },
    { value: "cavans", label: t("Cavans (estimated)") },
    { value: "kilos", label: t("Kilos (estimated)") },
  ];
  const firstUnit = units[shownUnits[0]];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {t("Palay (Paddy)")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t("Procurement and palay inventory")}
          </p>
        </div>
      </div>

      <Modal
        open={showForm}
        size="xl"
        title={t("New Palay Purchase")}
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
                  { value: "farm_gate", label: t("Farm Gate") },
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
                      placeholder: t("e.g. NSIC Rc 222"),
                    },
                    { key: "name", label: t("Name"), required: true },
                    {
                      key: "category",
                      label: t("Category"),
                      type: "select",
                      options: [
                        { value: "inbred", label: t("Inbred") },
                        { value: "hybrid", label: t("Hybrid") },
                        { value: "local", label: t("Local") },
                      ],
                      default: "inbred",
                    },
                    {
                      key: "typical_recovery_pct",
                      label: t("Recovery %"),
                      type: "number",
                      placeholder: "65",
                    },
                  ]}
                  transformBody={(b) => ({
                    ...b,
                    code: String(b.code).toUpperCase(),
                    kind: "palay",
                    typical_recovery_pct: b.typical_recovery_pct
                      ? parseFloat(b.typical_recovery_pct)
                      : null,
                  })}
                />
                <button
                  onClick={addItem}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {t("+ Add Item")}
                </button>
              </div>
            </div>
            {form.items.map((item, idx) => (
              <div
                key={idx}
                data-testid="purchase-line"
                className="space-y-2 p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg"
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <FieldCaption label={t("Variety")} className="col-span-2 sm:col-span-1">
                    <Select
                      aria-label={t("Variety")}
                      placeholder={t("Variety")}
                      value={item.variety_id}
                      onChange={(v) => setItem(idx, { variety_id: v })}
                      options={varietyOptions(varieties, "palay")}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Grade")}>
                    <Select
                      aria-label={t("Grade")}
                      placeholder={t("Grade")}
                      value={item.grade_id}
                      onChange={(v) => setItem(idx, { grade_id: v })}
                      options={grades.map((g: any) => ({ value: g.id, label: g.code }))}
                    />
                  </FieldCaption>
                  <div>
                    <span className="block mb-1 text-xs font-medium text-secondary">
                      {t("Condition")}
                    </span>
                    <WetDryChoice
                      wet={item.is_wet}
                      name={String(idx + 1)}
                      onChange={(wet) =>
                        setItem(
                          idx,
                          wet
                            ? { is_wet: true }
                            : { is_wet: false, dried_weight_kg: "", dried_moisture_pct: "" },
                        )
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <FieldCaption label={t("Sacks")}>
                    <input
                      className="input"
                      placeholder={t("Sacks")}
                      type="number"
                      min={0}
                      value={item.sack_count}
                      onChange={text(idx, "sack_count")}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Cavans (est.)")}>
                    <input
                      className="input"
                      placeholder={t("Optional")}
                      type="number"
                      min={0}
                      value={item.cavan_count}
                      onChange={text(idx, "cavan_count")}
                    />
                  </FieldCaption>
                  <FieldCaption
                    label={item.is_wet ? t("Wet weight (kg, est.)") : t("Kilos (est.)")}
                  >
                    <input
                      className="input"
                      placeholder={t("Optional")}
                      type="number"
                      min={0}
                      value={item.gross_weight_kg}
                      onChange={text(idx, "gross_weight_kg")}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Tare: sacks (kg)")}>
                    <input
                      className="input"
                      placeholder={t("Tare kg")}
                      type="number"
                      min={0}
                      value={item.tare_weight_kg}
                      onChange={text(idx, "tare_weight_kg")}
                    />
                  </FieldCaption>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <FieldCaption
                    label={item.is_wet ? t("Moisture before drying %") : t("Moisture %")}
                    className="col-span-2 sm:col-span-1"
                  >
                    <input
                      className="input"
                      placeholder={item.is_wet ? t("Moisture before drying %") : t("Moisture %")}
                      type="number"
                      min={0}
                      value={item.moisture_content_pct}
                      onChange={text(idx, "moisture_content_pct")}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Price per kg (₱)")}>
                    <input
                      className="input"
                      placeholder={t("₱/kg")}
                      type="number"
                      min={0}
                      value={item.price_per_kg}
                      onChange={text(idx, "price_per_kg")}
                    />
                  </FieldCaption>
                  <FieldCaption label={t("Price per cavan (₱)")}>
                    <input
                      className="input cursor-default tabular-nums opacity-70"
                      placeholder={t("₱/cavan")}
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value={cavanPrice(item.price_per_kg)}
                    />
                  </FieldCaption>
                </div>
                {item.is_wet && (
                  <div className="grid grid-cols-2 gap-2">
                    <FieldCaption label={t("Weight after drying (kg)")}>
                      <input
                        className="input"
                        placeholder={t("Weight after drying (kg)")}
                        type="number"
                        min={0}
                        value={item.dried_weight_kg}
                        onChange={text(idx, "dried_weight_kg")}
                      />
                    </FieldCaption>
                    <FieldCaption label={t("Moisture after drying %")}>
                      <input
                        className="input"
                        placeholder={t("Moisture after drying %")}
                        type="number"
                        min={0}
                        value={item.dried_moisture_pct}
                        onChange={text(idx, "dried_moisture_pct")}
                      />
                    </FieldCaption>
                  </div>
                )}
              </div>
            ))}
          </div>
          {createMutation.isError && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {typeof saveError === "string"
                ? saveError
                : t("Couldn't save. Check the sacks, cavans or kilos, and the price.")}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button
              onClick={() => createMutation.mutate(form)}
              className="btn-primary"
              disabled={createMutation.isPending || !ready}
            >
              {createMutation.isPending ? t("Saving…") : t("Save Purchase")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Stock index: what's on hand, always visible above the purchases */}
      <section className="space-y-2" data-testid="palay-stock-index">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">
            {t("Palay in stock")}
          </h3>
          {role === "owner" && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <span id="palay-view-by">{t("View by")}</span>
              <div role="radiogroup" aria-labelledby="palay-view-by" className="seg">
                {viewOptions.map(({ value, label }) => {
                  const Icon = viewIcons[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={stockView === value}
                      title={label}
                      disabled={chooseView.isPending}
                      className={`seg-btn !px-2.5 ${stockView === value ? "is-active" : ""}`}
                      onClick={() => stockView !== value && chooseView.mutate(value)}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {[
                  { key: "variety", label: t("Variety"), cls: "" },
                  { key: "grade", label: t("Grade"), cls: "" },
                  ...(stockInSeveralWarehouses
                    ? [{ key: "warehouse", label: t("Warehouse"), cls: "" }]
                    : []),
                  ...shownUnits.map((u) => ({
                    key: u,
                    label: units[u].label,
                    cls: unitClass(u),
                  })),
                ].map((h) => (
                  <th
                    key={h.key}
                    className={`px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300 ${h.cls}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {inventory.map((i: any) => (
                <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3" title={i.variety?.name}>
                    {i.variety?.code || "—"}
                    {Number(i.wet_kg) > 0 && (
                      <span className="badge-red ml-2 align-middle">
                        {t("{{amount}} wet", {
                          amount: `${amount(i[firstUnit.wet])} ${firstUnit.word}`,
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{i.grade?.code || "—"}</td>
                  {stockInSeveralWarehouses && (
                    <td className="px-4 py-3">{i.branch?.name || t("Unassigned")}</td>
                  )}
                  {shownUnits.map((u, n) => (
                    <td
                      key={u}
                      className={`px-4 py-3 tabular-nums ${n === 0 ? "font-medium" : "text-gray-500 dark:text-slate-400"} ${unitClass(u)}`}
                    >
                      {amount(i[units[u].stock])}
                    </td>
                  ))}
                </tr>
              ))}
              {inventoryLoading ? (
                <tr>
                  <td colSpan={stockColumns}>
                    <LoadingRows rows={2} />
                  </td>
                </tr>
              ) : (
                inventory.length === 0 && (
                  <tr>
                    <td colSpan={stockColumns} className="px-4 py-8 text-center text-muted">
                      {t(
                        "No palay in stock. Purchases you record show up here by variety and grade.",
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
          kind="palay"
          purchases={purchases}
          loading={purchasesLoading}
          canBuy={canEdit("paddy")}
          onNew={() => setShowForm(true)}
          empty={
            <EmptyState
              icon={Wheat}
              title={t("No palay bought yet")}
              action={canEdit("paddy") ? t("Record your first purchase") : undefined}
              onAction={() => setShowForm(true)}
              next="Next: mill it on the Milling page to turn it into rice."
            >
              {t(
                "Each time a farmer or trader delivers palay, record the weight, moisture and price here. It's added to your palay stock automatically.",
              )}
            </EmptyState>
          }
        />
        <SaleColumn kind="palay" />
      </div>
    </div>
  );
}
