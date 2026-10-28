import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { paddyService } from "../services/PaddyService";
import { Wheat } from "lucide-react";
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
import {
  PurchaseWarehouseField,
  inSeveralWarehouses,
  usePurchaseWarehouse,
} from "../components/PurchaseWarehouse";
import { t } from "../i18n";

export default function PaddyPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
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

  // Which warehouse the palay goes into (owner/admin pick; others: their own).
  const warehouse = usePurchaseWarehouse();
  // The stock table names the warehouse once stock sits in more than one.
  const stockInSeveralWarehouses = inSeveralWarehouses(inventory);

  const [form, setForm] = useState({
    purchase_date: format(new Date(), "yyyy-MM-dd"),
    delivery_type: "delivered",
    remarks: "",
    items: [
      {
        variety_id: "",
        grade_id: "",
        gross_weight_kg: "",
        tare_weight_kg: "0",
        moisture_content_pct: "",
        price_per_cavan: "",
      },
    ],
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

  const addItem = () =>
    setForm((f) => ({
      ...f,
      items: [
        ...f.items,
        {
          variety_id: "",
          grade_id: "",
          gross_weight_kg: "",
          tare_weight_kg: "0",
          moisture_content_pct: "",
          price_per_cavan: "",
        },
      ],
    }));

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
                      placeholder: t("e.g. Dinorado"),
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
                className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg"
              >
                <FieldCaption label={t("Variety")} className="col-span-2 sm:col-span-1">
                  <Select
                    aria-label={t("Variety")}
                    placeholder={t("Variety")}
                    value={item.variety_id}
                    onChange={(v) => {
                      const items = [...form.items];
                      items[idx].variety_id = v;
                      setForm((f) => ({ ...f, items }));
                    }}
                    options={varieties.map((v: any) => ({ value: v.id, label: v.code }))}
                  />
                </FieldCaption>
                <FieldCaption label={t("Grade")}>
                  <Select
                    aria-label={t("Grade")}
                    placeholder={t("Grade")}
                    value={item.grade_id}
                    onChange={(v) => {
                      const items = [...form.items];
                      items[idx].grade_id = v;
                      setForm((f) => ({ ...f, items }));
                    }}
                    options={grades.map((g: any) => ({ value: g.id, label: g.code }))}
                  />
                </FieldCaption>
                <FieldCaption label={t("Gross weight (kg)")}>
                  <input
                    className="input"
                    placeholder={t("Gross kg")}
                    type="number"
                    value={item.gross_weight_kg}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].gross_weight_kg = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label={t("Tare: sacks (kg)")}>
                  <input
                    className="input"
                    placeholder={t("Tare kg")}
                    type="number"
                    value={item.tare_weight_kg}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].tare_weight_kg = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label={t("Moisture %")}>
                  <input
                    className="input"
                    placeholder={t("Moisture %")}
                    type="number"
                    value={item.moisture_content_pct}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].moisture_content_pct = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label={t("Price per cavan (₱)")}>
                  <input
                    className="input"
                    placeholder={t("₱/cavan")}
                    type="number"
                    value={item.price_per_cavan}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].price_per_cavan = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
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
      <section className="space-y-2" data-testid="palay-stock-index">
        <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">
          {t("Palay in stock")}
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
                  t("Cavans"),
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
              {inventory.map((i: any) => (
                <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3">{i.variety?.code || "—"}</td>
                  <td className="px-4 py-3">{i.grade?.code || "—"}</td>
                  {stockInSeveralWarehouses && (
                    <td className="px-4 py-3">{i.branch?.name || t("Unassigned")}</td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    {Number(i.quantity_kg).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">
                    {t("{{toFixed}} cv", { toFixed: (Number(i.quantity_kg) / 50).toFixed(1) })}
                  </td>
                </tr>
              ))}
              {inventoryLoading ? (
                <tr>
                  <td colSpan={stockInSeveralWarehouses ? 5 : 4}>
                    <LoadingRows rows={2} />
                  </td>
                </tr>
              ) : (
                inventory.length === 0 && (
                  <tr>
                    <td
                      colSpan={stockInSeveralWarehouses ? 5 : 4}
                      className="px-4 py-8 text-center text-muted"
                    >
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
