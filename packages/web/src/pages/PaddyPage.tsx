import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  paddyService,
  blankPurchaseItem,
  pricePerCavan,
  purchaseLineProblems,
  purchaseLineReady,
  type PurchaseItemForm,
  type StockView,
} from "../services/PaddyService";
import { Container, LayoutGrid, Scale, ShoppingBag, Wheat, type LucideIcon } from "lucide-react";
import { format } from "date-fns";
import QuickAdd from "../components/QuickAdd";
import { useAccess } from "../hooks/useAccess";
import { useFeature } from "../hooks/useFeature";
import { useIsPhone } from "../hooks/useIsPhone";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import EmptyState from "../components/EmptyState";
import LoadingRows from "../components/LoadingRows";
import FieldCaption from "../components/FieldCaption";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import Modal from "../components/Modal";
import PalayTodo from "../components/buying/PalayTodo";
import ProfitLink from "../components/buying/ProfitLink";
import PurchaseColumn from "../components/buying/PurchaseColumn";
import SaleColumn from "../components/buying/SaleColumn";
import WetDryChoice from "../components/buying/WetDryChoice";
import {
  PurchaseWarehouseField,
  inSeveralBranches,
  inSeveralWarehouses,
  purchaseGridClass,
  usePurchaseWarehouse,
} from "../components/PurchaseWarehouse";
import { sortGrades } from "../utils/grades";
import { fixFields, needsInput } from "../utils/required";
import { STOCK_CELL as CELL, STOCK_FIGURE as FIGURE, stockDetails } from "../utils/stockTable";
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
  // The page's own To do window: Pro plans and up.
  const hasTodo = useFeature("page_todo");
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

  // Which branch and warehouse the palay goes into (owner/admin pick the branch;
  // others: their own).
  const warehouse = usePurchaseWarehouse();
  // The stock table names the branch once stock sits in more than one, and the
  // warehouse once a branch's stock sits in more than one.
  const stockInSeveralBranches = inSeveralBranches(inventory);
  const stockInSeveralWarehouses = inSeveralWarehouses(inventory);

  const [form, setForm] = useState({
    purchase_date: format(new Date(), "yyyy-MM-dd"),
    delivery_type: "delivered",
    remarks: "",
    items: [blankPurchaseItem()],
  });

  // After a try at saving with something missing, the empty fields say so.
  const [attempted, setAttempted] = useState(false);
  const closeForm = () => {
    setShowForm(false);
    setAttempted(false);
  };

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      paddyService.createPurchase({
        ...body,
        branch_id: warehouse.branchId,
        warehouse_id: warehouse.warehouseId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["palay-purchases"] });
      qc.invalidateQueries({ queryKey: ["palay-inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
      closeForm();
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
  // optional estimates) and a price. Wet palay is saved as Wet: it is completed
  // when its drying is recorded from the purchase's details.
  const ready = form.items.every(purchaseLineReady);
  const submit = () => {
    setAttempted(true);
    if (ready) createMutation.mutate(form);
  };
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
  // A phone has room for the variety and the amounts: the grade, and the branch and
  // warehouse when there are several, go in small print under the variety.
  const phone = useIsPhone();
  const stockColumns = phone
    ? 1 + shownUnits.length
    : 2 + Number(stockInSeveralBranches) + Number(stockInSeveralWarehouses) + shownUnits.length;
  const viewOptions: { value: StockView; label: string }[] = [
    { value: "all", label: t("All") },
    { value: "sacks", label: t("Sacks") },
    { value: "cavans", label: t("Cavans (estimated)") },
    { value: "kilos", label: t("Kilos (estimated)") },
  ];
  const firstUnit = units[shownUnits[0]];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
            {t("Palay (Paddy)")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t("Procurement and palay inventory")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ProfitLink />
          {hasTodo && <PalayTodo purchases={purchases} canRecord={canEdit("paddy")} />}
        </div>
      </div>

      <Modal
        open={showForm}
        size="xl"
        title={t("New Palay Purchase")}
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
            {form.items.map((item, idx) => {
              const problems = purchaseLineProblems(item);
              const flag = (missing: boolean, message = needsInput()) =>
                attempted && missing ? message : undefined;
              return (
                <div
                  key={idx}
                  data-testid="purchase-line"
                  className="space-y-4 rounded-xl bg-gray-50 p-4 ring-1 ring-soft dark:bg-slate-900/50"
                >
                  {/* Variety, grade and condition: a row each on a phone, so
                      "-- Select Grade --" isn't cut off; Grade and Condition share
                      a row from a tablet up, and all three from a laptop. */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <FieldCaption label={t("Variety")} className="col-span-2">
                      <Select
                        aria-label={t("Variety")}
                        value={item.variety_id}
                        onChange={(v) => setItem(idx, { variety_id: v })}
                        options={varietyOptions(varieties, "palay")}
                      />
                    </FieldCaption>
                    <FieldCaption label={t("Grade")} className="col-span-2 sm:col-span-1">
                      <Select
                        aria-label={t("Grade")}
                        value={item.grade_id}
                        onChange={(v) => setItem(idx, { grade_id: v })}
                        options={sortGrades(grades).map((g: any) => ({
                          value: g.id,
                          label: g.code,
                        }))}
                      />
                    </FieldCaption>
                    <div className="col-span-2 sm:col-span-1">
                      <span className="mb-1 block text-xs font-medium text-secondary">
                        {t("Condition")}
                      </span>
                      <WetDryChoice
                        wet={item.is_wet}
                        name={String(idx + 1)}
                        onChange={(wet) => setItem(idx, { is_wet: wet })}
                      />
                    </div>
                  </div>
                  {item.is_wet && (
                    <p className="-mt-2 text-xs text-muted">
                      {t(
                        "Wet palay is saved as Wet. Record its weight and moisture after drying from the purchase's details to complete it.",
                      )}
                    </p>
                  )}

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
                      {t("How much")}
                    </p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <FieldCaption
                        label={t("Sacks")}
                        error={flag(problems.counted, t("Enter the sacks, cavans or kilos."))}
                      >
                        <input
                          className="input"
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
                          placeholder="0"
                          type="number"
                          min={0}
                          value={item.tare_weight_kg}
                          onChange={text(idx, "tare_weight_kg")}
                        />
                      </FieldCaption>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
                      {t("Moisture and price")}
                    </p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <FieldCaption
                        label={item.is_wet ? t("Moisture when wet %") : t("Moisture %")}
                      >
                        <input
                          className="input"
                          placeholder={t("Optional")}
                          type="number"
                          min={0}
                          value={item.moisture_content_pct}
                          onChange={text(idx, "moisture_content_pct")}
                        />
                      </FieldCaption>
                      <FieldCaption label={t("Impurities %")}>
                        <input
                          className="input"
                          placeholder={t("Optional")}
                          type="number"
                          min={0}
                          value={item.impurity_pct}
                          onChange={text(idx, "impurity_pct")}
                        />
                      </FieldCaption>
                      <FieldCaption label={t("Price per kg (₱)")} error={flag(problems.price)}>
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
                  </div>
                </div>
              );
            })}
          </div>
          {attempted && !ready && (
            <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {fixFields()}
            </p>
          )}
          {createMutation.isError && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {typeof saveError === "string"
                ? saveError
                : t("Couldn't save. Check the sacks, cavans or kilos, and the price.")}
            </p>
          )}
          <div className="flex gap-2 justify-end">
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
        {/* A card that is still too narrow scrolls sideways, not cuts a column off. */}
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {[
                  { key: "variety", label: t("Variety"), cls: "" },
                  ...(phone ? [] : [{ key: "grade", label: t("Grade"), cls: "" }]),
                  ...(stockInSeveralBranches && !phone
                    ? [{ key: "branch", label: t("Branch"), cls: "" }]
                    : []),
                  ...(stockInSeveralWarehouses && !phone
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
                    className={`${CELL} text-left font-medium text-gray-600 dark:text-slate-300 ${h.cls}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {inventory.map((i: any) => {
                const under = stockDetails(
                  i.grade?.code,
                  stockInSeveralBranches && (i.branch?.name || t("Unassigned")),
                  stockInSeveralWarehouses && i.warehouse?.name,
                );
                const wet = Number(i.wet_kg) > 0 && (
                  <span className={phone ? "badge-red" : "badge-red ml-2 align-middle"}>
                    {t("{{amount}} wet", {
                      amount: `${amount(i[firstUnit.wet])} ${firstUnit.word}`,
                    })}
                  </span>
                );
                return (
                  <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                    <td className={CELL} title={i.variety?.name}>
                      {i.variety?.code || "—"}
                      {phone
                        ? (under || wet) && (
                            <span className="mt-0.5 flex max-w-[12rem] flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                              {under}
                              {wet}
                            </span>
                          )
                        : wet}
                    </td>
                    {!phone && (
                      <>
                        <td className={CELL}>{i.grade?.code || "—"}</td>
                        {stockInSeveralBranches && (
                          <td className={CELL}>{i.branch?.name || t("Unassigned")}</td>
                        )}
                        {stockInSeveralWarehouses && (
                          <td className={CELL}>{i.warehouse?.name || "—"}</td>
                        )}
                      </>
                    )}
                    {shownUnits.map((u, n) => (
                      <td
                        key={u}
                        className={`${FIGURE} tabular-nums ${n === 0 ? "font-medium" : "text-gray-500 dark:text-slate-400"} ${unitClass(u)}`}
                      >
                        {amount(i[units[u].stock])}
                      </td>
                    ))}
                  </tr>
                );
              })}
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
