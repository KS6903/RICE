import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminService } from "../../services/AdminService";
import { authService } from "../../services/AuthService";
import { useAuthStore } from "../../stores/authStore";
import PasswordInput from "../../components/PasswordInput";
import { TWO_MONTHS_FREE, annualPrice } from "../../utils/planPricing";
import { clsx } from "clsx";
import {
  CreditCard,
  User as UserIcon,
  KeyRound,
  Plus,
  Check,
  Loader2,
  AlertCircle,
  Settings as SettingsIcon,
  Pencil,
  Trash2,
  X as XIcon,
  Crown,
  Zap,
  Star,
  Rocket,
} from "lucide-react";

type Tab = "plans" | "profile" | "password";

const LABEL = "form-label";
const INPUT = "input";

const ERROR_BOX =
  "flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-900/30 ring-1 ring-rose-200 dark:ring-rose-800 text-sm text-rose-700 dark:text-rose-300";

// ── Plans tab ────────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  monthly_price: number;
  annual_price: number;
  annual_discount_percent: number;
  features: string[];
  max_branches: number | null;
  max_users: number | null;
  is_active: boolean;
  sort_order: number;
  payment_bank?: string | null;
  payment_account_name?: string | null;
  payment_account_number?: string | null;
};

const peso = (n: number) => `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const percent = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

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
    <tr>
      <td className="font-medium text-primary">
        <span className="flex items-center gap-2">
          <Icon size={15} className="text-emerald-500 shrink-0" />
          {plan.name}
          {!plan.is_active && <span className="badge-gray !text-[10px] !py-0.5">inactive</span>}
        </span>
      </td>
      <td className="font-mono text-xs text-secondary">{plan.code}</td>
      <td className="font-semibold text-primary tabular-nums">
        ₱{Number(plan.monthly_price).toLocaleString()}
        <span className="text-xs font-normal text-muted">/mo</span>
        {plan.annual_price > 0 && (
          <div className="text-xs font-normal text-muted">
            ₱{Number(plan.annual_price).toLocaleString()}/yr
            {plan.annual_discount_percent > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {" "}
                · {percent(plan.annual_discount_percent)} off
              </span>
            )}
          </div>
        )}
      </td>
      <td className="tabular-nums">
        {plan.max_branches === null ? "Unlimited" : plan.max_branches}
      </td>
      <td className="tabular-nums">{plan.max_users === null ? "Unlimited" : plan.max_users}</td>
      <td className="max-w-[200px] truncate text-muted">{plan.features.join(", ")}</td>
      <td className="text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(plan)}
            className="p-1.5 rounded-lg text-muted hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            title="Edit plan"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(plan.id)}
            className="p-1.5 rounded-lg text-muted hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
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
  annual_discount_percent: 0,
  features: [] as string[],
  max_branches: null as number | null,
  max_users: null as number | null,
  is_active: true,
  sort_order: 0,
  payment_bank: "",
  payment_account_name: "",
  payment_account_number: "",
};

const PLAN_COLS = ["Name", "Code", "Price", "Max branches", "Max users", "Features", "Actions"];

function PlansTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PLAN });
  const [featuresRaw, setFeaturesRaw] = useState("");
  const [saved, setSaved] = useState(false);

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["admin-plans"],
    queryFn: () => adminService.getPlans(),
  });

  const upsert = useMutation({
    mutationFn: (payload: typeof EMPTY_PLAN & { id?: string }) => {
      const { id, ...body } = payload;
      return id ? adminService.updatePlan(id, body) : adminService.createPlan(body);
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
    mutationFn: (id: string) => adminService.deletePlan(id),
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
      annual_discount_percent: p.annual_discount_percent,
      features: p.features,
      max_branches: p.max_branches,
      max_users: p.max_users,
      is_active: p.is_active,
      sort_order: p.sort_order,
      payment_bank: p.payment_bank ?? "",
      payment_account_name: p.payment_account_name ?? "",
      payment_account_number: p.payment_account_number ?? "",
    });
    setFeaturesRaw(p.features.join(", "));
    setShowForm(true);
  };

  const pricesValid =
    form.monthly_price >= 0 &&
    form.annual_discount_percent >= 0 &&
    form.annual_discount_percent < 100;
  const twelveMonths = form.monthly_price * 12;
  const yearlyPrice = annualPrice(form.monthly_price, form.annual_discount_percent);

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-primary">Subscription plans</h3>
          <p className="text-sm text-muted mt-0.5">Manage the plans available to your tenants</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <Check size={14} /> Saved
            </span>
          )}
          <button onClick={openNew} className="btn-primary !py-2 !text-sm">
            <Plus size={15} />
            New plan
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-primary">{editingId ? "Edit plan" : "New plan"}</h4>
            <button
              onClick={() => setShowForm(false)}
              className="text-muted hover:text-primary transition-colors"
            >
              <XIcon size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Plan code</label>
              <input
                className={INPUT}
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="e.g. pro"
              />
            </div>
            <div>
              <label className={LABEL}>Display name</label>
              <input
                className={INPUT}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Pro Plan"
              />
            </div>
            <div>
              <label htmlFor="plan-monthly-price" className={LABEL}>
                Monthly price (₱)
              </label>
              <input
                id="plan-monthly-price"
                type="number"
                min={0}
                className={INPUT}
                value={form.monthly_price}
                onChange={(e) => setForm((f) => ({ ...f, monthly_price: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label htmlFor="plan-annual-discount" className={LABEL}>
                Annual discount (%)
              </label>
              <input
                id="plan-annual-discount"
                type="number"
                min={0}
                max={99.99}
                step="any"
                className={INPUT}
                value={form.annual_discount_percent}
                onChange={(e) =>
                  setForm((f) => ({ ...f, annual_discount_percent: Number(e.target.value) }))
                }
                aria-describedby="plan-annual-discount-hint"
              />
              <p id="plan-annual-discount-hint" className="text-xs text-muted mt-1">
                Off 12 months, for tenants who pay yearly.{" "}
                <button
                  type="button"
                  className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                  onClick={() =>
                    setForm((f) => ({ ...f, annual_discount_percent: TWO_MONTHS_FREE }))
                  }
                >
                  Use 2 months free
                </button>
              </p>
            </div>
            <div
              className="sm:col-span-2 rounded-lg bg-emerald-500/5 ring-1 ring-emerald-500/20 px-4 py-3"
              aria-live="polite"
            >
              {pricesValid ? (
                <>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-sm font-medium text-secondary">Annual price</span>
                    <span className="text-lg font-bold text-primary tabular-nums">
                      <span data-testid="annual-price">{peso(yearlyPrice)}</span>
                      <span className="text-xs font-normal text-muted">/yr</span>
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1 tabular-nums">
                    {peso(form.monthly_price)} × 12 = {peso(twelveMonths)}
                    {form.annual_discount_percent > 0
                      ? `, less ${percent(form.annual_discount_percent)} (${peso(twelveMonths - yearlyPrice)})`
                      : ", no discount"}
                    . Worked out for you, to the nearest peso.
                  </p>
                </>
              ) : (
                <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                  The price can&apos;t be below ₱0, and the discount has to be from 0% up to (not
                  including) 100%.
                </p>
              )}
            </div>
            <div>
              <label className={LABEL}>Sort order</label>
              <input
                type="number"
                min={0}
                className={INPUT}
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                placeholder="Display order"
              />
            </div>
            <div>
              <label className={LABEL}>Max branches</label>
              <input
                type="number"
                min={1}
                className={INPUT}
                value={form.max_branches ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    max_branches: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                placeholder="Blank = unlimited"
              />
            </div>
            <div>
              <label className={LABEL}>Max users</label>
              <input
                type="number"
                min={1}
                className={INPUT}
                value={form.max_users ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    max_users: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                placeholder="Blank = unlimited"
              />
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
            <p className="text-xs text-muted mt-1">
              Feature codes that tenants on this plan can access.
            </p>
          </div>
          <fieldset className="rounded-lg ring-1 ring-line px-4 pt-3 pb-4">
            <legend className="px-1 text-sm font-semibold text-secondary">Payment account</legend>
            <p className="text-xs text-muted mb-3">
              Where tenants send the money for this plan. It shows on their checkout page. Leave
              blank until there is one.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="plan-payment-bank" className={LABEL}>
                  Bank
                </label>
                <input
                  id="plan-payment-bank"
                  className={INPUT}
                  maxLength={100}
                  value={form.payment_bank}
                  onChange={(e) => setForm((f) => ({ ...f, payment_bank: e.target.value }))}
                  placeholder="e.g. BDO"
                />
              </div>
              <div>
                <label htmlFor="plan-payment-account-name" className={LABEL}>
                  Account name
                </label>
                <input
                  id="plan-payment-account-name"
                  className={INPUT}
                  maxLength={150}
                  value={form.payment_account_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, payment_account_name: e.target.value }))
                  }
                />
              </div>
              <div>
                <label htmlFor="plan-payment-account-number" className={LABEL}>
                  Account number
                </label>
                <input
                  id="plan-payment-account-number"
                  className={`${INPUT} font-mono`}
                  maxLength={50}
                  value={form.payment_account_number}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, payment_account_number: e.target.value }))
                  }
                />
              </div>
            </div>
          </fieldset>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-line accent-emerald-600 cursor-pointer"
            />
            <span className="text-sm font-medium text-secondary">
              Plan is active (visible to tenants)
            </span>
          </label>
          {upsert.isError && (
            <div className={ERROR_BOX}>
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {/* A rejected field comes back as a list, not a sentence. */}
              {typeof (upsert.error as any)?.response?.data?.detail === "string"
                ? (upsert.error as any).response.data.detail
                : "Failed to save plan."}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={upsert.isPending || !form.code.trim() || !form.name.trim() || !pricesValid}
              className="btn-primary flex-1"
            >
              {upsert.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              {editingId ? "Save changes" : "Create plan"}
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-5 w-full" />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <span className="icon-chip mb-3">
              <CreditCard size={18} />
            </span>
            <p className="text-sm font-medium text-secondary">No plans configured yet</p>
            <p className="text-xs text-muted mt-0.5">
              Create your first plan to start onboarding tenants.
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {PLAN_COLS.map((h) => (
                  <th key={h} className={h === "Actions" ? "text-right" : ""}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
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
      await authService.updateProfile(form);
      return authService.me();
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
        <h3 className="text-lg font-bold text-primary">My profile</h3>
        <p className="text-sm text-muted mt-0.5">Update your admin display name and email</p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className={LABEL}>Full name</label>
          <input
            className={INPUT}
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            placeholder="Your name"
          />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input
            type="email"
            className={INPUT}
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="admin@example.com"
          />
        </div>
        <div>
          <label className={LABEL}>Username</label>
          <input className={INPUT} value={user?.username ?? ""} disabled readOnly />
          <p className="text-xs text-muted mt-1">Username cannot be changed.</p>
        </div>
        <div>
          <label className={LABEL}>Role</label>
          <input
            className={INPUT}
            value={user?.is_platform_admin ? "BossAdmin" : (user?.role ?? "")}
            disabled
            readOnly
          />
        </div>

        {save.isError && (
          <div className={ERROR_BOX}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {(save.error as any)?.response?.data?.detail || "Failed to save profile."}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Save profile
          </button>
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
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
    mutationFn: () => authService.changePassword(form.current, form.next),
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
        <h3 className="text-lg font-bold text-primary">Change password</h3>
        <p className="text-sm text-muted mt-0.5">Update your admin account password</p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className={LABEL}>Current password</label>
          <PasswordInput
            className={INPUT}
            value={form.current}
            onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className={LABEL}>New password</label>
          <PasswordInput
            className={INPUT}
            value={form.next}
            onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className={LABEL}>Confirm new password</label>
          <PasswordInput
            className={INPUT}
            value={form.confirm}
            onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            placeholder="••••••••"
          />
        </div>
        <p className="text-xs text-muted">Minimum 8 characters.</p>

        {err && (
          <div className={ERROR_BOX}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {err}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSubmit}
            disabled={change.isPending || !form.current || !form.next || !form.confirm}
            className="btn-primary"
          >
            {change.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Update password
          </button>
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
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
    { key: "profile", label: "My profile", icon: UserIcon },
    { key: "password", label: "Password", icon: KeyRound },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <SettingsIcon size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-primary">Admin settings</h2>
          <p className="text-sm text-muted">Manage subscription plans and your admin account</p>
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
                  className={clsx("nav-link w-full", active && "is-active")}
                >
                  <Icon
                    size={16}
                    className={clsx(
                      "shrink-0 transition-colors",
                      active
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-500 dark:text-slate-400",
                    )}
                  />
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
