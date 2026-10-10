import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { paddyService } from "../services/PaddyService";
import { Plus, Wheat } from "lucide-react";
import { format } from "date-fns";
import { roleLabel } from "@rice-mill/shared";
import QuickAdd from "../components/QuickAdd";
import { useAccess } from "../hooks/useAccess";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import EmptyState from "../components/EmptyState";
import FieldCaption from "../components/FieldCaption";
import TruncatedText from "../components/TruncatedText";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "badge-gray",
    received: "badge-yellow",
    completed: "badge-green",
    cancelled: "badge-red",
  };
  return <span className={map[status] || "badge-gray"}>{status}</span>;
}

export default function PaddyPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useOpenOnArrival();
  useEscapeKey(() => setShowForm(false), showForm);

  const { data: purchases = [] } = useQuery({
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
  const { data: inventory = [] } = useQuery({
    queryKey: ["palay-inventory"],
    queryFn: () => paddyService.listInventory(),
  });

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
    mutationFn: (body: typeof form) => paddyService.createPurchase(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["palay-purchases"] });
      qc.invalidateQueries({ queryKey: ["palay-inventory"] });
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
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Palay (Paddy)</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Procurement and palay inventory
          </p>
        </div>
        {canEdit("paddy") && (
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            <Plus size={16} /> New Purchase
          </button>
        )}
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">New Palay Purchase</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Purchase Date
              </label>
              <input
                type="date"
                className="input"
                value={form.purchase_date}
                onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Delivery Type
              </label>
              <select
                className="input"
                value={form.delivery_type}
                onChange={(e) => setForm((f) => ({ ...f, delivery_type: e.target.value }))}
              >
                <option value="delivered">Delivered</option>
                <option value="farm_gate">Farm Gate</option>
              </select>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-slate-200">
                Purchase Items
              </p>
              <div className="flex items-center gap-3">
                <QuickAdd
                  label="New variety"
                  endpoint="/paddy/varieties"
                  queryKey={["varieties"]}
                  fields={[
                    { key: "code", label: "Code", required: true, placeholder: "e.g. RC400" },
                    { key: "name", label: "Name", required: true },
                    {
                      key: "category",
                      label: "Category",
                      type: "select",
                      options: [
                        { value: "inbred", label: "Inbred" },
                        { value: "hybrid", label: "Hybrid" },
                        { value: "local", label: "Local" },
                      ],
                      default: "inbred",
                    },
                    {
                      key: "typical_recovery_pct",
                      label: "Recovery %",
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
                  + Add Item
                </button>
              </div>
            </div>
            {form.items.map((item, idx) => (
              <div
                key={idx}
                className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg"
              >
                <FieldCaption label="Variety" className="col-span-2 sm:col-span-1">
                  <select
                    className="input"
                    value={item.variety_id}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].variety_id = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  >
                    <option value="">Variety</option>
                    {varieties.map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.code}
                      </option>
                    ))}
                  </select>
                </FieldCaption>
                <FieldCaption label="Grade">
                  <select
                    className="input"
                    value={item.grade_id}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].grade_id = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  >
                    <option value="">Grade</option>
                    {grades.map((g: any) => (
                      <option key={g.id} value={g.id}>
                        {g.code}
                      </option>
                    ))}
                  </select>
                </FieldCaption>
                <FieldCaption label="Gross weight (kg)">
                  <input
                    className="input"
                    placeholder="Gross kg"
                    type="number"
                    value={item.gross_weight_kg}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].gross_weight_kg = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label="Tare: sacks (kg)">
                  <input
                    className="input"
                    placeholder="Tare kg"
                    type="number"
                    value={item.tare_weight_kg}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].tare_weight_kg = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label="Moisture %">
                  <input
                    className="input"
                    placeholder="Moisture %"
                    type="number"
                    value={item.moisture_content_pct}
                    onChange={(e) => {
                      const items = [...form.items];
                      items[idx].moisture_content_pct = e.target.value;
                      setForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label="Price per cavan (₱)">
                  <input
                    className="input"
                    placeholder="₱/cavan"
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
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate(form)}
              className="btn-primary"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Save Purchase"}
            </button>
          </div>
        </div>
      )}

      {/* Stock index: what's on hand, always visible above the purchases */}
      <section className="space-y-2" data-testid="palay-stock-index">
        <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">Palay in stock</h3>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {["Variety", "Grade", "Stock (kg)", "Cavans"].map((h) => (
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
                  <td className="px-4 py-3 font-medium">
                    {Number(i.quantity_kg).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">
                    {(Number(i.quantity_kg) / 50).toFixed(1)} cv
                  </td>
                </tr>
              ))}
              {inventory.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No palay in stock. Purchases you record show up here by variety and grade.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2" data-testid="palay-purchases">
        <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">Purchases</h3>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {["Reference", "Date", "Supplier", "Status", "Items", "Added by"].map((h) => (
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
              {purchases.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3 font-mono text-xs">{p.reference_no}</td>
                  <td className="px-4 py-3">{p.purchase_date}</td>
                  <td className="px-4 py-3">
                    {p.supplier?.name ? (
                      <TruncatedText
                        text={p.supplier.name}
                        className="max-w-[9rem] sm:max-w-[14rem]"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">
                    {p.item_count ?? 0} item(s)
                  </td>
                  <td className="px-4 py-3" data-testid="purchase-added-by">
                    {p.created_by_name ? (
                      <>
                        <TruncatedText
                          text={p.created_by_name}
                          className="max-w-[9rem] sm:max-w-[14rem] text-gray-900 dark:text-slate-100"
                        />
                        <div className="text-xs text-gray-500 dark:text-slate-400">
                          {roleLabel(p.created_by_role)}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {purchases.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Wheat}
                      title="No palay bought yet"
                      action={canEdit("paddy") ? "Record your first purchase" : undefined}
                      onAction={() => setShowForm(true)}
                      next="Next: mill it on the Milling page to turn it into rice."
                    >
                      Each time a farmer or trader delivers palay, record the weight, moisture and
                      price here. It's added to your palay stock automatically.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
