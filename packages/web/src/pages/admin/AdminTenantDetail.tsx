import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import api from "../../services/api";
import { format } from "date-fns";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Users as UsersIcon,
  Power,
  CreditCard,
  Check,
  Loader2,
  Crown,
  Zap,
  Rocket,
  AlertCircle,
} from "lucide-react";

/* ─── Plan icon helper ─── */
function PlanIcon({ code, size = 18 }: { code: string; size?: number }) {
  if (code === "enterprise") return <Crown size={size} />;
  if (code === "pro") return <Zap size={size} />;
  return <Rocket size={size} />;
}

/* ─── Status badge color helper ─── */
function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "badge-green",
    trial: "badge-yellow",
    past_due: "badge-yellow",
    cancelled: "badge-red",
    expired: "badge-red",
  };
  return map[status] || "badge-gray";
}

/* ─── Plan tier ring color ─── */
function planRing(code: string, selected: boolean) {
  if (!selected) return "border-slate-200 hover:border-slate-300";
  const map: Record<string, string> = {
    free: "border-emerald-500 ring-2 ring-emerald-200",
    pro: "border-indigo-500 ring-2 ring-indigo-200",
    enterprise: "border-amber-500 ring-2 ring-amber-200",
  };
  return map[code] || "border-indigo-500 ring-2 ring-indigo-200";
}

/* ─── Subscription Management Card ─── */
function SubscriptionManager({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();

  /* Fetch available plans */
  const { data: plans = [] } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () => api.get("/admin/plans").then((r) => r.data),
  });

  /* Fetch current subscription */
  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ["admin-tenant-sub", tenantId],
    queryFn: () =>
      api.get(`/admin/tenants/${tenantId}/subscription`).then((r) => r.data),
    enabled: !!tenantId,
  });

  const currentSub = subData?.subscription;

  /* Local form state — synced once data loads */
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [status, setStatus] = useState("active");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saved, setSaved] = useState(false);

  /* Sync defaults when sub data first arrives */
  if (currentSub && selectedPlanId === null) {
    setSelectedPlanId(currentSub.plan_id);
    setStatus(currentSub.status);
    setExpiresAt(
      currentSub.expires_at
        ? currentSub.expires_at.slice(0, 16) // for datetime-local input
        : ""
    );
    setNotes(currentSub.notes || "");
  }

  /* Mutation to assign/update subscription */
  const assign = useMutation({
    mutationFn: (payload: any) =>
      api.put(`/admin/tenants/${tenantId}/subscription`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant-sub", tenantId] });
      qc.invalidateQueries({ queryKey: ["admin-tenant", tenantId] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const handleSave = () => {
    if (!selectedPlanId) return;
    assign.mutate({
      plan_id: selectedPlanId,
      status,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      notes: notes || null,
    });
  };

  if (subLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Loading subscription…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-slate-500" />
          <h3 className="font-semibold text-slate-900">Subscription</h3>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-indigo-600 hover:text-indigo-700 text-xs font-medium"
          >
            Change plan
          </button>
        )}
      </div>

      {/* Current plan summary (always visible) */}
      <div className="px-6 py-4">
        {currentSub ? (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <PlanIcon code={currentSub.plan_code} />
              <span className="text-lg font-bold text-slate-900">
                {currentSub.plan_name}
              </span>
            </div>
            <span className={statusBadge(currentSub.status)}>
              {currentSub.status}
            </span>
            <span className="text-sm text-slate-500">
              {currentSub.monthly_price === 0
                ? "Free"
                : `₱${currentSub.monthly_price.toLocaleString()}/mo`}
            </span>
            {currentSub.max_users && (
              <span className="text-xs text-slate-400">
                {currentSub.max_users} users ·{" "}
                {currentSub.max_branches || "∞"} branches
              </span>
            )}
            {currentSub.expires_at && (
              <span className="text-xs text-slate-400">
                Expires{" "}
                {format(new Date(currentSub.expires_at), "MMM d, yyyy")}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertCircle size={14} />
            No subscription assigned. Choose a plan below.
          </div>
        )}
      </div>

      {/* Plan picker + options (expanded) */}
      {(showForm || !currentSub) && (
        <div className="px-6 pb-6 space-y-5 border-t border-slate-100 pt-5">
          {/* Plan cards */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Choose plan
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {plans
                .filter((p: any) => p.is_active)
                .map((p: any) => {
                  const selected = selectedPlanId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`relative text-left rounded-xl border-2 p-4 transition-all ${planRing(
                        p.code,
                        selected
                      )}`}
                    >
                      {selected && (
                        <span className="absolute top-2 right-2 bg-indigo-600 text-white rounded-full p-0.5">
                          <Check size={10} />
                        </span>
                      )}
                      <div className="flex items-center gap-2 mb-1">
                        <PlanIcon code={p.code} size={16} />
                        <span className="font-bold text-slate-900">
                          {p.name}
                        </span>
                      </div>
                      <div className="text-lg font-bold text-slate-900">
                        {p.monthly_price === 0
                          ? "Free"
                          : `₱${p.monthly_price.toLocaleString()}`}
                        {p.monthly_price > 0 && (
                          <span className="text-xs font-normal text-slate-400">
                            /mo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {p.description}
                      </p>
                      <div className="mt-2 text-xs text-slate-400">
                        {p.max_users ? `${p.max_users} users` : "Unlimited users"} ·{" "}
                        {p.max_branches
                          ? `${p.max_branches} branches`
                          : "Unlimited branches"}
                      </div>
                      {p.features && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(p.features as string[]).slice(0, 5).map((f: string) => (
                            <span
                              key={f}
                              className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded"
                            >
                              {f.replace(/_/g, " ")}
                            </span>
                          ))}
                          {p.features.length > 5 && (
                            <span className="text-[10px] text-slate-400">
                              +{p.features.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Status + expiry row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="input"
              >
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="past_due">Past due</option>
                <option value="cancelled">Cancelled</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Expires at
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input"
                placeholder="e.g. Payment via GCash"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={!selectedPlanId || assign.isPending}
              className="btn-primary"
            >
              {assign.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Check size={14} /> Save subscription
                </>
              )}
            </button>
            {currentSub && (
              <button
                onClick={() => setShowForm(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            )}
            {saved && (
              <span className="text-sm text-emerald-600 font-medium animate-pulse">
                Subscription updated!
              </span>
            )}
            {assign.isError && (
              <span className="text-sm text-rose-600">
                Failed to update. Please try again.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function AdminTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenant", id],
    queryFn: () => api.get(`/admin/tenants/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const toggle = useMutation({
    mutationFn: (is_active: boolean) =>
      api.put(`/admin/tenants/${id}/active`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant", id] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  if (isLoading || !data) {
    return <div className="text-slate-500">Loading…</div>;
  }

  const c = data.company;
  const m = data.metrics;

  return (
    <div className="space-y-6">
      <Link
        to="/admin/tenants"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={14} /> Back to tenants
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 size={22} /> {c.name}
            </h2>
            {c.is_active ? (
              <span className="badge-green">Active</span>
            ) : (
              <span className="badge-red">Inactive</span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Tenant ID: <span className="font-mono">{c.id}</span>
          </p>
        </div>
        <button
          onClick={() => toggle.mutate(!c.is_active)}
          disabled={toggle.isPending}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm ${
            c.is_active
              ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
          title={
            c.is_active
              ? "Deactivate this tenant — blocks all logins"
              : "Activate this tenant — restores login"
          }
        >
          <Power size={14} />
          {toggle.isPending
            ? "Saving…"
            : c.is_active
            ? "Deactivate tenant"
            : "Activate tenant"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* ─── Subscription Management ─── */}
          <SubscriptionManager tenantId={id!} />

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">
              Company information
            </h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">Address</dt>
                <dd className="text-slate-900">{c.address || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">TIN</dt>
                <dd className="text-slate-900">{c.tin || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-900">{c.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-900">{c.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">NFA License</dt>
                <dd className="text-slate-900">{c.nfa_license_no || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">DA Reg.</dt>
                <dd className="text-slate-900">
                  {c.da_registration_no || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Currency</dt>
                <dd className="text-slate-900">{c.currency}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Timezone</dt>
                <dd className="text-slate-900">{c.timezone}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Multi-branch</dt>
                <dd className="text-slate-900">
                  {c.is_multi_branch ? "Yes" : "No"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Signed up</dt>
                <dd className="text-slate-900">
                  {c.created_at
                    ? format(
                        new Date(c.created_at),
                        "MMM d, yyyy 'at' HH:mm"
                      )
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <UsersIcon size={16} className="text-slate-500" />
              <h3 className="font-semibold text-slate-900">
                Users ({data.users.length})
              </h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {[
                    "Username",
                    "Full name",
                    "Email",
                    "Role",
                    "Status",
                    "Last login",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left font-medium text-slate-600"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.users.map((u: any) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-mono text-xs">
                      {u.username}
                    </td>
                    <td className="px-4 py-3">{u.full_name}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {u.email || "—"}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {u.role?.replace("_", " ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="badge-green">Active</span>
                      ) : (
                        <span className="badge-red">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {u.last_login
                        ? format(new Date(u.last_login), "MMM d, HH:mm")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <MapPin size={16} className="text-slate-500" />
              <h3 className="font-semibold text-slate-900">
                Branches ({data.branches.length})
              </h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Name", "Type", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left font-medium text-slate-600"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.branches.map((b: any) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3">
                      {b.is_main_branch ? (
                        <span className="badge-green">Main</span>
                      ) : (
                        <span className="badge-gray">Branch</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {b.is_active ? (
                        <span className="badge-green">Active</span>
                      ) : (
                        <span className="badge-red">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Activity</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Purchases</dt>
                <dd className="font-semibold">
                  {m.purchases_count.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Milling batches</dt>
                <dd className="font-semibold">
                  {m.batches_count.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Sales orders</dt>
                <dd className="font-semibold">
                  {m.orders_count.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Invoices</dt>
                <dd className="font-semibold">
                  {m.invoices_count.toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Money</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Revenue</dt>
                <dd className="font-semibold text-emerald-600">
                  ₱{m.total_revenue.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Expenses</dt>
                <dd className="font-semibold text-rose-600">
                  ₱{m.total_expenses.toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
