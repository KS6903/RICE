import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import {
  CreditCard, User as UserIcon, KeyRound, Plus, Check, Loader2,
  AlertCircle, Settings as SettingsIcon, Pencil, Trash2, X as XIcon,
  Crown, Zap, Star, Rocket,
} from "lucide-react";

type Tab = "plans" | "profile" | "password";

const LABEL = "block text-sm font-semibold text-slate-700 mb-1.5";
const INPUT =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors";

// ── Plans tab ────────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  monthly_price: number;
  features: string[];
  max_branches: number | null;
  max_users: number | null;
  is_active: boolean;
  sort_order: number;
};

const PLAN_ICONS: Record<string, React.ElementType> = {
  enterprise: Crown,
  pro: Zap,
  basic: Star,
  free: Rocket,
};

function PlanRow({
  plan,
  onEdit,
  onDelete,
}: {
  plan: Plan;
  onEdit: (p: Plan) => void;
  onDelete: (id: string) => void;
}) {
  const Icon = PLAN_ICONS[plan.code] ?? Rocket;
  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-slate-900 flex items-center gap-2">
        <Icon size={15} className="text-indigo-500 shrink-0" />
        {plan.name}
        {!plan.is_active && (
          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 uppercase tracking-wide">
            inactive
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 font-mono">{plan.code}</td>
      <td className="px-4 py-3 text-sm text-slate-900 font-semibold">
        ₱{Number(plan.monthly_price).toLocaleString()}
        <span className="text-xs font-normal text-slate-400">/mo</span>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {plan.max_branches === null ? "Unlimited" : plan.max_branches}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {plan.max_users === null ? "Unlimited" : plan.max_users}
      </td>
      <td className="px-4 py-3 text-sm text-slate-500 max-w-[200px] truncate">
        {plan.features.join(", ")}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(plan)}
            className="p-1.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 text-slate-400 transition-colors"
            title="Edit plan"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(plan.id)}
            className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-colors"
            title="Delete plan"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

const EMPTY_PLAN = {
  code: "",
  name: "",
  description: "" as string,
  monthly_price: 0,
  features: [] as string[],
  max_branches: null as number | null,
  max_users: null as number | null,
  is_active: true,
  sort_order: 0,
};

function PlansTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PLAN });
  const [featuresRaw, setFeaturesRaw] = useState("");
  const [saved, setSaved] = useState(false);

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["admin-plans"],
    queryFn: () => api.get("/admin/plans").then((r) => r.data),
  });

  const upsert = useMutation({
    mutationFn: (payload: typeof EMPTY_PLAN & { id?: string }) => {
      const { id, ...body } = payload;
      return id
        ? api.put(`/admin/plans/${id}`, body).then((r) => r.data)
        : api.post("/admin/plans", body).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      qc.invalidateQueries({ queryKey: ["billing-plans"] });
      setShowForm(false);
      setEditingId(null);
      setForm({ ...EMPTY_PLAN });
      setFeaturesRaw("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/plans/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      qc.invalidateQueries({ queryKey: ["billing-plans"] });
    },
  });

  const openNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_PLAN });
    setFeaturesRaw("");
    setShowForm(true);
  };

  const openEdit = (p: Plan) => {
    setEditingId(p.id);
    setForm({
      code: p.code,
      name: p.name,
      description: p.description ?? "",
      monthly_price: p.monthly_price,
      features: p.features,
      max_branches: p.max_branches,
      max_users: p.max_users,
      is_active: p.is_active,
      sort_order: p.sort_order,
    });
    setFeaturesRaw(p.features.join(", "));
    setShowForm(true);
  };

  const handleSubmit = () => {
    const payload = {
      ...form,
      features: featuresRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      ...(editingId !== null ? { id: editingId } : {}),
    };
    upsert.mutate(payload);
  };

  const TH = "px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 bg-gradient-to-r from-indigo-50/80 via-violet-50/60 to-slate-50/80 border-b border-slate-200";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Subscription Plans</h3>
          <p className="text-sm text-slate-500 mt-0.5">Manage the plans available to your tenants</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 inline-flex items-center gap-1">
              <Check size={14} /> Saved
            </span>
          )}
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm">
            <Plus size={15} />
            New Plan
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-900">{editingId ? "Edit Plan" : "New Plan"}</h4>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
              <XIcon size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Plan Code</label>
              <input className={INPUT} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. pro" />
            </div>
            <div>
              <label className={LABEL}>Display Name</label>
              <input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Pro Plan" />
            </div>
            <div>
              <label className={LABEL}>Monthly Price (₱)</label>
              <input type="number" min={0} className={INPUT} value={form.monthly_price} onChange={(e) => setForm((f) => ({ ...f, monthly_price: Number(e.target.value) }))} />
            </div>
            <div>
              <label className={LABEL}>Sort Order</label>
              <input type="number" min={0} className={INPUT} value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))} placeholder="Display order" />
            </div>
            <div>
              <label className={LABEL}>Max Branches</label>
              <input type="number" min={1} className={INPUT} value={form.max_branches ?? ""} onChange={(e) => setForm((f) => ({ ...f, max_branches: e.target.value === "" ? null : Number(e.target.value) }))} placeholder="Blank = unlimited" />
            </div>
            <div>
              <label className={LABEL}>Max Users</label>
              <input type="number" min={1} className={INPUT} value={form.max_users ?? ""} onChange={(e) => setForm((f) => ({ ...f, max_users: e.target.value === "" ? null : Number(e.target.value) }))} placeholder="Blank = unlimited" />
            </div>
          </div>
          <div>
            <label className={LABEL}>Features (comma-separated)</label>
            <textarea
              rows={2}
              className={INPUT}
              value={featuresRaw}
              onChange={(e) => setFeaturesRaw(e.target.value)}
              placeholder="paddy, milling, inventory, reports, users"
            />
            <p className="text-xs text-slate-400 mt-1">
              Feature codes that tenants on this plan can access.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-indigo-600 cursor-pointer"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-slate-700 cursor-pointer select-none">
              Plan is active (visible to tenants)
            </label>
          </div>
          {upsert.isError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-sm text-rose-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {(upsert.error as any)?.response?.data?.detail || "Failed to save plan."}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={upsert.isPending || !form.code.trim() || !form.name.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {upsert.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {editingId ? "Save Changes" : "Create Plan"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2">
            <AlertCircle size={16} /> No plans configured yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Code</th>
                <th className={TH}>Price</th>
                <th className={TH}>Max Branches</th>
                <th className={TH}>Max Users</th>
                <th className={TH}>Features</th>
                <th className={TH + " text-right"}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plans.map((p) => (
                <PlanRow key={p.id} plan={p} onEdit={openEdit} onDelete={(id) => del.mutate(id)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user, setUser } = useAuthStore();
  const [form, setForm] = useState({
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (user) setForm({ full_name: user.full_name ?? "", email: user.email ?? "" });
  }, [user]);

  const save = useMutation({
    mutationFn: async () => {
      await api.put("/auth/me", form);
      const { data: me } = await api.get("/auth/me");
      return me;
    },
    onSuccess: (me) => {
      setUser(me);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-900">My Profile</h3>
        <p className="text-sm text-slate-500 mt-0.5">Update your admin display name and email</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div>
          <label className={LABEL}>Full Name</label>
          <input className={INPUT} value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} placeholder="Your name" />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input type="email" className={INPUT} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="admin@example.com" />
        </div>
        <div>
          <label className={LABEL}>Username</label>
          <input className={INPUT} value={user?.username ?? ""} disabled readOnly />
          <p className="text-xs text-slate-400 mt-1">Username cannot be changed.</p>
        </div>
        <div>
          <label className={LABEL}>Role</label>
          <input className={INPUT} value={user?.role ?? ""} disabled readOnly />
        </div>

        {save.isError && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-sm text-rose-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {(save.error as any)?.response?.data?.detail || "Failed to save profile."}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Save Profile
          </button>
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 inline-flex items-center gap-1">
              <Check size={14} /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Password tab ──────────────────────────────────────────────────────────────

function PasswordTab() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const change = useMutation({
    mutationFn: () =>
      api.post("/auth/change-password", {
        current_password: form.current,
        new_password: form.next,
      }),
    onSuccess: () => {
      setForm({ current: "", next: "", confirm: "" });
      setSaved(true);
      setErr("");
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e: any) => {
      setErr(e.response?.data?.detail || "Failed to change password.");
    },
  });

  const handleSubmit = () => {
    setErr("");
    if (form.next !== form.confirm) return setErr("New passwords do not match.");
    if (form.next.length < 8) return setErr("Password must be at least 8 characters.");
    change.mutate();
  };

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-900">Change Password</h3>
        <p className="text-sm text-slate-500 mt-0.5">Update your admin account password</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div>
          <label className={LABEL}>Current Password</label>
          <input type="password" className={INPUT} value={form.current} onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))} placeholder="••••••••" />
        </div>
        <div>
          <label className={LABEL}>New Password</label>
          <input type="password" className={INPUT} value={form.next} onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))} placeholder="••••••••" />
        </div>
        <div>
          <label className={LABEL}>Confirm New Password</label>
          <input type="password" className={INPUT} value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} placeholder="••••••••" />
        </div>
        <p className="text-xs text-slate-400">Minimum 8 characters.</p>

        {err && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-sm text-rose-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {err}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSubmit}
            disabled={change.isPending || !form.current || !form.next || !form.confirm}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {change.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Update Password
          </button>
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 inline-flex items-center gap-1">
              <Check size={14} /> Password updated
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const [tab, setTab] = useState<Tab>("plans");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "plans", label: "Plans", icon: CreditCard },
    { key: "profile", label: "My Profile", icon: UserIcon },
    { key: "password", label: "Password", icon: KeyRound },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-600 shadow-sm">
          <SettingsIcon size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Admin Settings</h2>
          <p className="text-sm text-slate-500">Manage subscription plans and your admin account</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <aside className="w-full md:w-52 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0">
            {tabs.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap w-full text-left ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                  }`}
                >
                  <Icon size={16} className={active ? "text-white" : "text-slate-400"} />
                  {label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 min-w-0">
          {tab === "plans" && <PlansTab />}
          {tab === "profile" && <ProfileTab />}
          {tab === "password" && <PasswordTab />}
        </div>
      </div>
    </div>
  );
}
