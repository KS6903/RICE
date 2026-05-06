import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { useAuthStore } from "../stores/authStore";
import { Building2, MapPin, User as UserIcon, KeyRound, Plus, Wheat, Factory, Receipt, Power, History, ChevronDown, ChevronUp, CreditCard, Check, X as XIcon } from "lucide-react";
import { useCurrentPlan } from "../hooks/useFeature";

type Tab = "billing" | "company" | "branches" | "varieties" | "equipment" | "categories" | "profile" | "password";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("billing");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "billing", label: "Billing", icon: CreditCard },
    { key: "company", label: "Company", icon: Building2 },
    { key: "branches", label: "Branches", icon: MapPin },
    { key: "varieties", label: "Rice Varieties", icon: Wheat },
    { key: "equipment", label: "Equipment", icon: Factory },
    { key: "categories", label: "Expense Categories", icon: Receipt },
    { key: "profile", label: "My Profile", icon: UserIcon },
    { key: "password", label: "Password", icon: KeyRound },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500">Manage your account, company, and branches</p>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {tab === "billing" && <BillingTab />}
      {tab === "company" && <CompanyTab />}
      {tab === "branches" && <BranchesTab />}
      {tab === "varieties" && <VarietiesTab />}
      {tab === "equipment" && <EquipmentTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "profile" && <ProfileTab />}
      {tab === "password" && <PasswordTab />}
    </div>
  );
}

const FEATURE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  paddy: "Paddy procurement",
  milling: "Milling operations",
  inventory: "Inventory tracking",
  sales: "Sales & invoices",
  expenses: "Expense tracking",
  users: "User management",
  employees: "Employees module",
  multi_branch: "Multiple branches",
  reports_advanced: "Advanced reports (AR aging, valuation)",
  compliance_reports: "DA / NFA compliance reports",
  offline_sync: "Offline sync (Electron desktop)",
};

const ALL_FEATURE_KEYS = Object.keys(FEATURE_LABELS);

function BillingTab() {
  const plan = useCurrentPlan();
  const user = useAuthStore((s) => s.user);
  const features = ((user as any)?.features as string[] | undefined) || [];

  if (!plan) {
    return <div className="card text-sm text-gray-500">No subscription on file. Contact your platform administrator.</div>;
  }

  const planColor = plan.code === "free" ? "bg-gray-100 text-gray-700" : plan.code === "pro" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700";

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500">Current plan</p>
            <div className="flex items-baseline gap-3 mt-1">
              <h3 className="text-2xl font-bold text-gray-900">{plan.name}</h3>
              <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${planColor}`}>{plan.code}</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {plan.monthly_price > 0 ? `₱${plan.monthly_price.toLocaleString()}/month` : "Free forever"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Status</p>
            <p className="text-sm font-medium capitalize text-gray-900">{plan.status}</p>
            {plan.expires_at && <p className="text-xs text-gray-500 mt-1">Expires {new Date(plan.expires_at).toLocaleDateString()}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-200 text-sm">
          <div>
            <p className="text-gray-500">User limit</p>
            <p className="font-medium text-gray-900">{plan.max_users ?? "Unlimited"}</p>
          </div>
          <div>
            <p className="text-gray-500">Branch limit</p>
            <p className="font-medium text-gray-900">{plan.max_branches ?? "Unlimited"}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">What's included in {plan.name}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ALL_FEATURE_KEYS.map((key) => {
            const included = features.includes(key);
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                {included ? <Check size={14} className="text-emerald-600" /> : <XIcon size={14} className="text-gray-300" />}
                <span className={included ? "text-gray-900" : "text-gray-400 line-through"}>{FEATURE_LABELS[key]}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <p className="font-medium mb-1">Need more features?</p>
        <p>Contact your platform administrator to upgrade your plan. Pro unlocks Employees and advanced reports; Enterprise adds compliance reports and offline sync.</p>
      </div>
    </div>
  );
}

function VarietyRow({ v, user, onToggle }: { v: any; user: any; onToggle: () => void }) {
  const isOwn = v.company_id === user?.company_id;
  return (
    <tr className={`hover:bg-gray-50 ${!v.is_active ? "opacity-60" : ""}`}>
      <td className="px-4 py-3 font-mono text-xs">{v.code}</td>
      <td className="px-4 py-3 font-medium">{v.name}</td>
      <td className="px-4 py-3 capitalize">{v.category || "—"}</td>
      <td className="px-4 py-3">{v.typical_recovery_pct ? `${v.typical_recovery_pct}%` : "—"}</td>
      <td className="px-4 py-3">{isOwn ? <span className="badge-green">Custom</span> : <span className="badge-gray">System</span>}</td>
      <td className="px-4 py-3">{v.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
      <td className="px-4 py-3">
        {isOwn && (
          <button
            onClick={onToggle}
            className={`text-xs inline-flex items-center gap-1 ${v.is_active ? "text-rose-600 hover:text-rose-700" : "text-emerald-600 hover:text-emerald-700"}`}
          >
            <Power size={12} />
            {v.is_active ? "Deactivate" : "Activate"}
          </button>
        )}
      </td>
    </tr>
  );
}

function VarietiesTab() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showHistory, setShowHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", category: "inbred", typical_recovery_pct: "" });

  const { data: varieties = [] } = useQuery({
    queryKey: ["varieties-all"],
    queryFn: () => api.get(`/paddy/varieties?include_inactive=true`).then((r) => r.data),
  });
  const active = varieties.filter((v: any) => v.is_active);
  const inactive = varieties.filter((v: any) => !v.is_active);

  const create = useMutation({
    mutationFn: (b: typeof form) => api.post("/paddy/varieties", { ...b, typical_recovery_pct: b.typical_recovery_pct ? parseFloat(b.typical_recovery_pct) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["varieties-all"] });
      qc.invalidateQueries({ queryKey: ["varieties"] });
      setShowForm(false);
      setForm({ code: "", name: "", category: "inbred", typical_recovery_pct: "" });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => api.put(`/paddy/varieties/${id}`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["varieties-all"] });
      qc.invalidateQueries({ queryKey: ["varieties"] });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Add custom rice varieties for your company. System varieties (NSIC Rc222 etc.) are shared across all clients but can't be modified.
      </p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add variety
        </button>
      </div>

      {showForm && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-900">New variety</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
              <input className="input" placeholder="e.g. RC400" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input className="input" placeholder="e.g. NSIC Rc400" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                <option value="inbred">Inbred</option>
                <option value="hybrid">Hybrid</option>
                <option value="local">Local</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Typical recovery %</label>
              <input className="input" type="number" placeholder="65" value={form.typical_recovery_pct} onChange={(e) => setForm((f) => ({ ...f, typical_recovery_pct: e.target.value }))} />
            </div>
          </div>
          {create.isError && <p className="text-sm text-red-600">{(create.error as any)?.response?.data?.detail || "Failed to add variety."}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => create.mutate(form)} className="btn-primary" disabled={create.isPending || !form.code || !form.name}>
              {create.isPending ? "Saving…" : "Save variety"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{["Code", "Name", "Category", "Recovery %", "Source", "Status", ""].map((h) => <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {active.map((v: any) => (
              <VarietyRow key={v.id} v={v} user={user} onToggle={() => toggle.mutate({ id: v.id, is_active: false })} />
            ))}
            {active.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No active varieties</td></tr>}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-50/50">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                Deactivated history ({inactive.length})
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {inactive.map((v: any) => (
                    <VarietyRow key={v.id} v={v} user={user} onToggle={() => toggle.mutate({ id: v.id, is_active: true })} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EquipmentRow({ e, onToggle }: { e: any; onToggle: () => void }) {
  return (
    <tr className={`hover:bg-gray-50 ${!e.is_active ? "opacity-60" : ""}`}>
      <td className="px-4 py-3 font-medium">{e.name}</td>
      <td className="px-4 py-3 text-gray-500">{e.model || "—"}</td>
      <td className="px-4 py-3">{e.capacity_kg_per_hr ? `${e.capacity_kg_per_hr} kg/hr` : "—"}</td>
      <td className="px-4 py-3">{e.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
      <td className="px-4 py-3">
        <button
          onClick={onToggle}
          className={`text-xs inline-flex items-center gap-1 ${e.is_active ? "text-rose-600 hover:text-rose-700" : "text-emerald-600 hover:text-emerald-700"}`}
        >
          <Power size={12} />
          {e.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  );
}

function EquipmentTab() {
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", model: "", capacity_kg_per_hr: "" });

  const { data: equipment = [] } = useQuery({
    queryKey: ["equipment-all"],
    queryFn: () => api.get(`/milling/equipment?include_inactive=true`).then((r) => r.data),
  });
  const active = equipment.filter((e: any) => e.is_active);
  const inactive = equipment.filter((e: any) => !e.is_active);

  const create = useMutation({
    mutationFn: (b: typeof form) => api.post("/milling/equipment", { ...b, capacity_kg_per_hr: b.capacity_kg_per_hr ? parseFloat(b.capacity_kg_per_hr) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-all"] });
      qc.invalidateQueries({ queryKey: ["equipment"] });
      setShowForm(false);
      setForm({ name: "", model: "", capacity_kg_per_hr: "" });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => api.put(`/milling/equipment/${id}`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-all"] });
      qc.invalidateQueries({ queryKey: ["equipment"] });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Add and manage milling equipment for your company.</p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add equipment
        </button>
      </div>

      {showForm && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-900">New equipment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input className="input" placeholder="e.g. Mill #1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <input className="input" placeholder="e.g. SB-30" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacity (kg/hr)</label>
              <input className="input" type="number" placeholder="500" value={form.capacity_kg_per_hr} onChange={(e) => setForm((f) => ({ ...f, capacity_kg_per_hr: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => create.mutate(form)} className="btn-primary" disabled={create.isPending || !form.name}>
              {create.isPending ? "Saving…" : "Save equipment"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{["Name", "Model", "Capacity", "Status", ""].map((h) => <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {active.map((e: any) => (
              <EquipmentRow key={e.id} e={e} onToggle={() => toggle.mutate({ id: e.id, is_active: false })} />
            ))}
            {active.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No active equipment</td></tr>}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-50/50">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                Deactivated history ({inactive.length})
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {inactive.map((e: any) => (
                    <EquipmentRow key={e.id} e={e} onToggle={() => toggle.mutate({ id: e.id, is_active: true })} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoriesTab() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", is_production_cost: true });

  const { data: categories = [] } = useQuery({ queryKey: ["expense-categories"], queryFn: () => api.get("/costs/categories").then((r) => r.data) });

  const create = useMutation({
    mutationFn: (b: typeof form) => api.post("/costs/categories", b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-categories"] }); setShowForm(false); setForm({ name: "", is_production_cost: true }); },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Categorize your expenses (Fuel, Electricity, Labor, etc.). System defaults are shared across all clients.</p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add category
        </button>
      </div>

      {showForm && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-900">New expense category</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category name *</label>
            <input className="input" placeholder="e.g. Sack/Packaging" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.is_production_cost} onChange={(e) => setForm((f) => ({ ...f, is_production_cost: e.target.checked }))} />
            Production cost (vs. overhead)
          </label>
          {create.isError && <p className="text-sm text-red-600">{(create.error as any)?.response?.data?.detail || "Failed to add category."}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => create.mutate(form)} className="btn-primary" disabled={create.isPending || !form.name}>
              {create.isPending ? "Saving…" : "Save category"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{["Name", "Type", "Source"].map((h) => <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categories.map((c: any) => {
              const isOwn = c.company_id === user?.company_id;
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.is_production_cost ? <span className="badge-green">Production</span> : <span className="badge-gray">Overhead</span>}</td>
                  <td className="px-4 py-3">{isOwn ? <span className="badge-green">Custom</span> : <span className="badge-gray">System</span>}</td>
                </tr>
              );
            })}
            {categories.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No categories</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompanyTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["company"], queryFn: () => api.get("/branches/company").then((r) => r.data) });
  const [form, setForm] = useState<any>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: any) => api.put("/branches/company", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading) return <div className="card text-sm text-gray-500">Loading…</div>;

  const fields: { label: string; key: string; full?: boolean }[] = [
    { label: "Company Name *", key: "name", full: true },
    { label: "Address", key: "address", full: true },
    { label: "TIN", key: "tin" },
    { label: "Phone", key: "phone" },
    { label: "Email", key: "email" },
    { label: "NFA License No.", key: "nfa_license_no" },
    { label: "DA Registration No.", key: "da_registration_no" },
  ];

  return (
    <div className="card max-w-2xl space-y-4">
      <h3 className="font-semibold text-gray-900">Company Information</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(({ label, key, full }) => (
          <div key={key} className={full ? "sm:col-span-2" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input
              className="input"
              value={form[key] || ""}
              onChange={(e) => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={!!form.is_multi_branch}
              onChange={(e) => setForm((f: any) => ({ ...f, is_multi_branch: e.target.checked }))}
            />
            Enable multi-branch mode
          </label>
        </div>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button onClick={() => save.mutate(form)} className="btn-primary" disabled={save.isPending || !form.name}>
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-sm text-brand-700">Saved ✓</span>}
        {save.isError && <span className="text-sm text-red-600">Failed to save.</span>}
      </div>
    </div>
  );
}

function BranchesTab() {
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery({ queryKey: ["branches"], queryFn: () => api.get("/branches/").then((r) => r.data) });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", is_main_branch: false });

  const create = useMutation({
    mutationFn: (body: typeof form) => api.post("/branches/", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      setShowForm(false);
      setForm({ name: "", address: "", is_main_branch: false });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{branches.length} branch{branches.length === 1 ? "" : "es"}</p>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add branch
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900">New branch</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_main_branch}
              onChange={(e) => setForm((f) => ({ ...f, is_main_branch: e.target.checked }))}
            />
            Mark as main branch
          </label>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => create.mutate(form)} className="btn-primary" disabled={create.isPending || !form.name}>
              {create.isPending ? "Creating…" : "Create branch"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{["Name", "Address", "Type", "Status"].map((h) => <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {branches.map((b: any) => (
              <tr key={b.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{b.name}</td>
                <td className="px-4 py-3 text-gray-500">{b.address || "—"}</td>
                <td className="px-4 py-3">{b.is_main_branch ? <span className="badge-green">Main</span> : <span className="badge-gray">Branch</span>}</td>
                <td className="px-4 py-3">{b.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
              </tr>
            ))}
            {branches.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No branches</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState({ full_name: user?.full_name || "", email: user?.email || "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (body: typeof form) => api.put("/auth/me", body),
    onSuccess: async () => {
      const { data } = await api.get("/auth/me");
      setUser(data);
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e: any) => setError(e.response?.data?.detail || "Failed to update."),
  });

  return (
    <div className="card max-w-xl space-y-4">
      <h3 className="font-semibold text-gray-900">My profile</h3>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
        <input className="input bg-gray-50" value={user?.username || ""} disabled />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
        <input className="input" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input type="email" className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate(form)} className="btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="text-sm text-brand-700">Saved ✓</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function PasswordTab() {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const change = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) => api.post("/auth/change-password", body),
    onSuccess: () => {
      setMsg({ type: "ok", text: "Password changed successfully." });
      setForm({ current_password: "", new_password: "", confirm: "" });
    },
    onError: (e: any) => setMsg({ type: "err", text: e.response?.data?.detail || "Failed to change password." }),
  });

  const submit = () => {
    setMsg(null);
    if (form.new_password !== form.confirm) return setMsg({ type: "err", text: "New passwords do not match." });
    if (form.new_password.length < 8) return setMsg({ type: "err", text: "New password must be at least 8 characters." });
    change.mutate({ current_password: form.current_password, new_password: form.new_password });
  };

  return (
    <div className="card max-w-md space-y-4">
      <h3 className="font-semibold text-gray-900">Change password</h3>
      {[
        { label: "Current password", key: "current_password" },
        { label: "New password", key: "new_password" },
        { label: "Confirm new password", key: "confirm" },
      ].map(({ label, key }) => (
        <div key={key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
          <input
            type="password"
            className="input"
            value={(form as any)[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          />
        </div>
      ))}
      {msg && <p className={`text-sm ${msg.type === "ok" ? "text-brand-700" : "text-red-600"}`}>{msg.text}</p>}
      <button onClick={submit} className="btn-primary" disabled={change.isPending || !form.current_password || !form.new_password}>
        {change.isPending ? "Changing…" : "Change password"}
      </button>
    </div>
  );
}
