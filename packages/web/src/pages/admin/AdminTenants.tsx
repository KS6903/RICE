import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminService } from "../../services/AdminService";
import { format } from "date-fns";
import {
  Search,
  ExternalLink,
  Power,
  History,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Wand2,
  ShieldOff,
  Crown,
  Zap,
  Rocket,
  Star,
  Infinity as InfinityIcon,
} from "lucide-react";

const COLS = ["Company", "Plan", "Signed up", "Users", "Branches", "Activity", "Status", ""];

function planIcon(code: string | null, size = 12) {
  if (code === "enterprise") return <Crown size={size} />;
  if (code === "pro") return <Zap size={size} />;
  if (code === "basic") return <Star size={size} />;
  if (code === "free") return <Rocket size={size} />;
  return null;
}

function planBadge(code: string | null, name: string | null) {
  if (!code) return <span className="badge-red text-[10px]">No plan</span>;
  const cls =
    code === "enterprise"
      ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
      : code === "pro"
        ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200"
        : code === "basic"
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200"
          : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}
    >
      {planIcon(code)} {name}
    </span>
  );
}

function subStatusPill(status: string | null) {
  if (!status) return null;
  const cls =
    status === "active"
      ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
      : status === "trial"
        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
        : status === "past_due"
          ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
          : status === "expired" || status === "cancelled"
            ? "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300"
            : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200";
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}
    >
      {status}
    </span>
  );
}

function TenantRow({
  t,
  onToggle,
  busy,
}: {
  t: any;
  onToggle: (next: boolean) => void;
  busy: boolean;
}) {
  return (
    <tr
      className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 ${!t.is_active ? "opacity-60" : ""}`}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900 dark:text-slate-100">{t.name}</div>
        {t.email && <div className="text-xs text-slate-500 dark:text-slate-400">{t.email}</div>}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {planBadge(t.plan_code, t.plan_name)}
          {subStatusPill(t.subscription_status)}
        </div>
        {t.has_subscription !== false && (t.started_at || t.expires_at) && (
          <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
            {t.started_at && <div>Started {format(new Date(t.started_at), "MMM d, yyyy")}</div>}
            {t.expires_at ? (
              <div>Until {format(new Date(t.expires_at), "MMM d, yyyy")}</div>
            ) : t.subscription_status === "active" ? (
              <div className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <InfinityIcon size={10} /> Permanent
              </div>
            ) : null}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
        {t.created_at ? format(new Date(t.created_at), "MMM d, yyyy") : "—"}
      </td>
      <td className="px-4 py-3 font-medium">{t.users_count}</td>
      <td className="px-4 py-3 font-medium">{t.branches_count}</td>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
        <span className="text-xs">
          {t.purchases_count}p · {t.orders_count}o
        </span>
      </td>
      <td className="px-4 py-3">
        {t.is_active ? (
          <span className="badge-green">Active</span>
        ) : (
          <span className="badge-red">Inactive</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 justify-end">
          <Link
            to={`/admin/tenants/${t.id}`}
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 inline-flex items-center gap-1 text-xs font-medium"
          >
            <ExternalLink size={12} /> Open
          </Link>
          <button
            onClick={() => onToggle(!t.is_active)}
            disabled={busy}
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              t.is_active
                ? "text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
            }`}
            title={
              t.is_active ? "Deactivate this tenant (blocks all logins)" : "Reactivate this tenant"
            }
          >
            <Power size={12} />
            {t.is_active ? "Deactivate" : "Activate"}
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function AdminTenants() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: () => adminService.getTenants(),
  });

  const { data: missing } = useQuery({
    queryKey: ["admin-missing-subs"],
    queryFn: () => adminService.getMissingCount(),
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      adminService.setTenantActive(id, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tenants"] }),
  });

  const backfill = useMutation({
    mutationFn: () => adminService.backfillFree(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      qc.invalidateQueries({ queryKey: ["admin-missing-subs"] });
    },
  });

  const sweep = useMutation({
    mutationFn: () => adminService.sweepExpired(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  const matches = (t: any) =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.email || "").toLowerCase().includes(search.toLowerCase());

  const active = tenants.filter((t: any) => t.is_active && matches(t));
  const inactive = tenants.filter((t: any) => !t.is_active && matches(t));
  const missingCount = missing?.missing || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Tenants</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {active.length} active · {inactive.length} deactivated
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => sweep.mutate()}
            disabled={sweep.isPending}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            title="Mark subscriptions whose expires_at has passed as expired"
          >
            <ShieldOff size={14} />
            {sweep.isPending ? "Sweeping…" : "Sweep expired"}
          </button>
          {sweep.isSuccess && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              {(sweep.data as any)?.data?.expired ?? 0} expired
            </span>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              className="input pl-9 w-64"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {missingCount > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">
              {missingCount} tenant{missingCount === 1 ? "" : "s"} without a subscription
            </p>
            <p className="text-amber-800 dark:text-amber-200 mt-0.5">
              These tenants have no plan and no feature access. Assign the Free plan to restore
              basic functionality.
            </p>
          </div>
          <button
            onClick={() => backfill.mutate()}
            disabled={backfill.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
          >
            <Wand2 size={14} />
            {backfill.isPending ? "Fixing…" : `Backfill Free plan (${missingCount})`}
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-indigo-50/80 via-violet-50/60 to-slate-50/80 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {COLS.map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-300"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {isLoading && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading &&
              active.map((t: any) => (
                <TenantRow
                  key={t.id}
                  t={t}
                  busy={toggle.isPending}
                  onToggle={(next) => toggle.mutate({ id: t.id, is_active: next })}
                />
              ))}
            {!isLoading && active.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-8 text-center text-slate-400">
                  {search ? "No active tenants match your search." : "No active tenants."}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50/50">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                Deactivated history ({inactive.length})
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {inactive.map((t: any) => (
                    <TenantRow
                      key={t.id}
                      t={t}
                      busy={toggle.isPending}
                      onToggle={(next) => toggle.mutate({ id: t.id, is_active: next })}
                    />
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
