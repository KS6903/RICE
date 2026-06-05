import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { Plus, Power, History, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { SUPPLIER_TYPES } from "@rice-mill/shared";
import QuickAdd from "../components/QuickAdd";
import { useAccess } from "../hooks/useAccess";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "badge-gray", received: "badge-yellow", completed: "badge-green", cancelled: "badge-red",
  };
  return <span className={map[status] || "badge-gray"}>{status}</span>;
}

export default function PaddyPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<"purchases" | "suppliers" | "inventory">("purchases");

  const [showSupplierHistory, setShowSupplierHistory] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: "", supplier_type: "farmer", contact_person: "", phone: "", municipality: "", province: "", farmer_id: "", address: "" });

  const { data: purchases = [] } = useQuery({ queryKey: ["palay-purchases"], queryFn: () => api.get("/paddy/purchases").then(r => r.data) });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api.get(`/paddy/suppliers?include_inactive=true`).then(r => r.data),
  });
  const activeSuppliers = suppliers.filter((s: any) => s.is_active);
  const inactiveSuppliers = suppliers.filter((s: any) => !s.is_active);
  const { data: varieties = [] } = useQuery({ queryKey: ["varieties"], queryFn: () => api.get("/paddy/varieties").then(r => r.data) });
  const { data: grades = [] } = useQuery({ queryKey: ["grades"], queryFn: () => api.get("/paddy/grades").then(r => r.data) });
  const { data: inventory = [] } = useQuery({ queryKey: ["palay-inventory"], queryFn: () => api.get("/paddy/inventory").then(r => r.data) });

  const createSupplier = useMutation({
    mutationFn: (b: typeof supplierForm) => api.post("/paddy/suppliers", b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setShowSupplierForm(false);
      setSupplierForm({ name: "", supplier_type: "farmer", contact_person: "", phone: "", municipality: "", province: "", farmer_id: "", address: "" });
    },
  });

  const toggleSupplier = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => api.put(`/paddy/suppliers/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });

  const [form, setForm] = useState({
    supplier_id: "", purchase_date: format(new Date(), "yyyy-MM-dd"), delivery_type: "delivered",
    remarks: "",
    items: [{ variety_id: "", grade_id: "", gross_weight_kg: "", tare_weight_kg: "0", moisture_content_pct: "", price_per_cavan: "" }],
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => api.post("/paddy/purchases", {
      ...body,
      items: body.items.map(i => ({
        variety_id: i.variety_id || null,
        grade_id: i.grade_id || null,
        gross_weight_kg: parseFloat(i.gross_weight_kg),
        tare_weight_kg: parseFloat(i.tare_weight_kg) || 0,
        moisture_content_pct: i.moisture_content_pct ? parseFloat(i.moisture_content_pct) : null,
        price_per_cavan: parseFloat(i.price_per_cavan),
      })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["palay-purchases"] }); qc.invalidateQueries({ queryKey: ["palay-inventory"] }); setShowForm(false); },
  });

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { variety_id: "", grade_id: "", gross_weight_kg: "", tare_weight_kg: "0", moisture_content_pct: "", price_per_cavan: "" }] }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Palay (Paddy)</h2>
          <p className="text-sm text-gray-500">Procurement, suppliers, and palay inventory</p>
        </div>
        {canEdit("paddy") && (
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            <Plus size={16} /> New Purchase
          </button>
        )}
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900">New Palay Purchase</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Supplier</label>
                <QuickAdd
                  label="New supplier"
                  endpoint="/paddy/suppliers"
                  queryKey={["suppliers"]}
                  fields={[
                    { key: "name", label: "Name", required: true, full: true },
                    { key: "supplier_type", label: "Type", type: "select", options: SUPPLIER_TYPES.map(t => ({ value: t.value, label: t.label })), default: "farmer" },
                    { key: "phone", label: "Phone" },
                    { key: "municipality", label: "Municipality" },
                    { key: "province", label: "Province" },
                  ]}
                  onCreated={(c) => setForm((f) => ({ ...f, supplier_id: c.id }))}
                />
              </div>
              <select className="input" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
                <option value="">Select supplier…</option>
                {activeSuppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
              <input type="date" className="input" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Type</label>
              <select className="input" value={form.delivery_type} onChange={e => setForm(f => ({ ...f, delivery_type: e.target.value }))}>
                <option value="delivered">Delivered</option>
                <option value="farm_gate">Farm Gate</option>
              </select>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Purchase Items</p>
              <div className="flex items-center gap-3">
                <QuickAdd
                  label="New variety"
                  endpoint="/paddy/varieties"
                  queryKey={["varieties"]}
                  fields={[
                    { key: "code", label: "Code", required: true, placeholder: "e.g. RC400" },
                    { key: "name", label: "Name", required: true },
                    { key: "category", label: "Category", type: "select", options: [
                      { value: "inbred", label: "Inbred" },
                      { value: "hybrid", label: "Hybrid" },
                      { value: "local", label: "Local" },
                    ], default: "inbred" },
                    { key: "typical_recovery_pct", label: "Recovery %", type: "number", placeholder: "65" },
                  ]}
                  transformBody={(b) => ({
                    ...b,
                    code: String(b.code).toUpperCase(),
                    typical_recovery_pct: b.typical_recovery_pct ? parseFloat(b.typical_recovery_pct) : null,
                  })}
                />
                <button onClick={addItem} className="text-sm text-brand-600 hover:text-brand-700">+ Add Item</button>
              </div>
            </div>
            {form.items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-3 bg-gray-50 rounded-lg">
                <select className="input col-span-2 sm:col-span-1" value={item.variety_id} onChange={e => { const items = [...form.items]; items[idx].variety_id = e.target.value; setForm(f => ({ ...f, items })); }}>
                  <option value="">Variety</option>
                  {varieties.map((v: any) => <option key={v.id} value={v.id}>{v.code}</option>)}
                </select>
                <select className="input" value={item.grade_id} onChange={e => { const items = [...form.items]; items[idx].grade_id = e.target.value; setForm(f => ({ ...f, items })); }}>
                  <option value="">Grade</option>
                  {grades.map((g: any) => <option key={g.id} value={g.id}>{g.code}</option>)}
                </select>
                <input className="input" placeholder="Gross kg" type="number" value={item.gross_weight_kg} onChange={e => { const items = [...form.items]; items[idx].gross_weight_kg = e.target.value; setForm(f => ({ ...f, items })); }} />
                <input className="input" placeholder="Tare kg" type="number" value={item.tare_weight_kg} onChange={e => { const items = [...form.items]; items[idx].tare_weight_kg = e.target.value; setForm(f => ({ ...f, items })); }} />
                <input className="input" placeholder="Moisture %" type="number" value={item.moisture_content_pct} onChange={e => { const items = [...form.items]; items[idx].moisture_content_pct = e.target.value; setForm(f => ({ ...f, items })); }} />
                <input className="input" placeholder="₱/cavan" type="number" value={item.price_per_cavan} onChange={e => { const items = [...form.items]; items[idx].price_per_cavan = e.target.value; setForm(f => ({ ...f, items })); }} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => createMutation.mutate(form)} className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save Purchase"}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200">
        {(["purchases", "suppliers", "inventory"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t}</button>
        ))}
      </div>

      {tab === "purchases" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Reference", "Date", "Supplier", "Status", "Items"].map(h => <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchases.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.reference_no}</td>
                  <td className="px-4 py-3">{p.purchase_date}</td>
                  <td className="px-4 py-3">{p.supplier?.name || "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-gray-500">{p.items?.length || 0} item(s)</td>
                </tr>
              ))}
              {purchases.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No purchases yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "inventory" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>{["Variety", "Grade", "Stock (kg)", "Cavans"].map(h => <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inventory.map((i: any) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{i.variety?.code || "—"}</td>
                  <td className="px-4 py-3">{i.grade?.code || "—"}</td>
                  <td className="px-4 py-3 font-medium">{Number(i.quantity_kg).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">{(Number(i.quantity_kg) / 50).toFixed(1)} cv</td>
                </tr>
              ))}
              {inventory.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No palay in stock</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "suppliers" && (
        <>
          <div className="flex justify-end">
            {canEdit("paddy") && (
            <button onClick={() => setShowSupplierForm(!showSupplierForm)} className="btn-primary">
              <Plus size={16} /> Add supplier
            </button>
            )}
          </div>

          {showSupplierForm && (
            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-900">New supplier</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input className="input" value={supplierForm.name} onChange={(e) => setSupplierForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select className="input" value={supplierForm.supplier_type} onChange={(e) => setSupplierForm((f) => ({ ...f, supplier_type: e.target.value }))}>
                    {SUPPLIER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact person</label>
                  <input className="input" value={supplierForm.contact_person} onChange={(e) => setSupplierForm((f) => ({ ...f, contact_person: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input className="input" value={supplierForm.phone} onChange={(e) => setSupplierForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Municipality</label>
                  <input className="input" value={supplierForm.municipality} onChange={(e) => setSupplierForm((f) => ({ ...f, municipality: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Province</label>
                  <input className="input" value={supplierForm.province} onChange={(e) => setSupplierForm((f) => ({ ...f, province: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Farmer ID (RSBSA / PhilSys)</label>
                  <input className="input" value={supplierForm.farmer_id} onChange={(e) => setSupplierForm((f) => ({ ...f, farmer_id: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input className="input" value={supplierForm.address} onChange={(e) => setSupplierForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowSupplierForm(false)} className="btn-secondary">Cancel</button>
                <button onClick={() => createSupplier.mutate(supplierForm)} className="btn-primary" disabled={createSupplier.isPending || !supplierForm.name}>
                  {createSupplier.isPending ? "Saving…" : "Save supplier"}
                </button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>{["Name", "Type", "Municipality", "Phone", "Farmer ID", "Status", ""].map(h => <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeSuppliers.map((s: any) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 capitalize">{s.supplier_type || "—"}</td>
                    <td className="px-4 py-3">{s.municipality || "—"}</td>
                    <td className="px-4 py-3">{s.phone || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.farmer_id || "—"}</td>
                    <td className="px-4 py-3"><span className="badge-green">Active</span></td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleSupplier.mutate({ id: s.id, is_active: false })}
                        className="text-xs text-rose-600 hover:text-rose-700 inline-flex items-center gap-1"
                      >
                        <Power size={12} /> Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
                {activeSuppliers.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No active suppliers</td></tr>}
              </tbody>
            </table>

            {inactiveSuppliers.length > 0 && (
              <div className="border-t border-gray-200 bg-gray-50/50">
                <button
                  onClick={() => setShowSupplierHistory(!showSupplierHistory)}
                  className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <History size={14} />
                    Deactivated history ({inactiveSuppliers.length})
                  </span>
                  {showSupplierHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showSupplierHistory && (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {inactiveSuppliers.map((s: any) => (
                        <tr key={s.id} className="hover:bg-gray-50 opacity-60">
                          <td className="px-4 py-3 font-medium">{s.name}</td>
                          <td className="px-4 py-3 capitalize">{s.supplier_type || "—"}</td>
                          <td className="px-4 py-3">{s.municipality || "—"}</td>
                          <td className="px-4 py-3">{s.phone || "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs">{s.farmer_id || "—"}</td>
                          <td className="px-4 py-3"><span className="badge-red">Inactive</span></td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleSupplier.mutate({ id: s.id, is_active: true })}
                              className="text-xs text-emerald-600 hover:text-emerald-700 inline-flex items-center gap-1"
                            >
                              <Power size={12} /> Activate
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
