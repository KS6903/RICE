import { ProvisioningBadge } from "../../components/admin/Provisioning";
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
import { t } from "../../i18n";

const COLS = [
  t("Company"),
  t("Plan"),
  t("Signed up"),
  t("Users"),
  t("Branches"),
  t("Activity"),
  t("Status"),
  "",
];

function planIcon(code: string | null, size = 12) {
  if (code === "enterprise") return <Crown size={size} />;
  if (code === "pro") return <Zap size={size} />;
  if (code === "basic") return <Star size={size} />;
  if (code === "free") return <Rocket size={size} />;
  return null;
}

/** Plan tone mirrors the tenant Header's PlanBadge so plan colors mean the
 *  same thing across the whole product. */
function planBadge(code: string | null, name: string | null) {
  if (!code) return <span className="badge-red">{t("No plan")}</span>;
  const tone =
    code === "enterprise"
      ? "badge-yellow"
      : code === "pro"
        ? "badge-violet"
        : code === "basic"
          ? "badge-cyan"
          : "badge-green";
  return (
    <span className={tone}>
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
  t: tenant,
  onToggle,
  busy,
}: {
  t: any;
  onToggle: (next: boolean) => void;
  busy: boolean;
}) {
  return (
    <tr className={!tenant.is_active ? "opacity-60" : ""}>
      <td>
        <div className="font-medium text-primary">{tenant.name}</div>
        {tenant.email && <div className="text-xs text-muted">{tenant.email}</div>}
      </td>
      <td>
        <div className="flex items-center gap-2 flex-wrap">
          {planBadge(tenant.plan_code, tenant.plan_name)}
          {subStatusPill(tenant.subscription_status)}
        </div>
        {tenant.has_subscription !== false && (tenant.started_at || tenant.expires_at) && (
          <div className="text-[11px] text-muted mt-1 leading-snug">
            {tenant.started_at && (
              <div>
                {t("Started {{format}}", {
                  format: format(new Date(tenant.started_at), "MMM d, yyyy"),
                })}
              </div>
            )}
            {tenant.expires_at ? (
              <div>
                {t("Until {{format}}", {
                  format: format(new Date(tenant.expires_at), "MMM d, yyyy"),
                })}
              </div>
            ) : tenant.subscription_status === "active" ? (
              <div className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <InfinityIcon size={10} /> {t("Permanent")}
              </div>
            ) : null}
          </div>
        )}
      </td>
      <td>{tenant.created_at ? format(new Date(tenant.created_at), "MMM d, yyyy") : "—"}</td>
      <td className="font-medium text-primary tabular-nums">{tenant.users_count}</td>
      <td className="font-medium text-primary tabular-nums">{tenant.branches_count}</td>
      <td>
        <span className="text-xs tabular-nums">
          {tenant.purchases_count}p · {tenant.orders_count}o
        </span>
      </td>
      <td>
        <div className="flex flex-col items-start gap-1">
          {tenant.is_active ? (
            <span className="badge-green">{t("Active")}</span>
          ) : (
            <span className="badge-gray">{t("Inactive")}</span>
          )}
          <ProvisioningBadge info={tenant.provisioning} />
        </div>
      </td>
      <td>
        <div className="flex items-center gap-3 justify-end">
          <Link
            to={`/admin/tenants/${tenant.id}`}
            className="link inline-flex items-center gap-1 text-xs"
          >
            <ExternalLink size={12} /> {t("Open")}
          </Link>
          <button
            onClick={() => onToggle(!tenant.is_active)}
            disabled={busy}
            className={`inline-flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              tenant.is_active
                ? "text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
            }`}
            title={
              tenant.is_active
                ? t("Deactivate this tenant (blocks all logins)")
                : t("Reactivate this tenant")
            }
          >
            <Power size={12} />
            {tenant.is_active ? t("Deactivate") : t("Activate")}
          </button>
        </div>
      </td>
    </tr>
  );
}

function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {COLS.map((_, j) => (
            <td key={j}>
              <div className="skeleton h-4" style={{ width: j === 0 ? "70%" : "50%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
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
          <h2 className="text-2xl font-bold text-primary">{t("Tenants")}</h2>
          <p className="text-sm text-muted">
            {t("{{activeCount}} active · {{inactiveCount}} deactivated", {
              activeCount: active.length,
              inactiveCount: inactive.length,
            })}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          {sweep.isSuccess && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {(sweep.data as any)?.data?.expired ?? 0} {t("expired")}
            </span>
          )}
          <button
            onClick={() => sweep.mutate()}
            disabled={sweep.isPending}
            className="btn-secondary !py-2 !text-sm"
            title={t("Mark subscriptions whose expiry has passed as expired")}
          >
            <ShieldOff size={14} />
            {sweep.isPending ? t("Sweeping…") : t("Sweep expired")}
          </button>
          <div className="relative min-w-0 w-full sm:w-64">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              className="input pl-9"
              placeholder={t("Search by name or email…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {missingCount > 0 && (
        <div className="card !p-4 flex items-center gap-3 border-amber-300/60 dark:border-amber-700/50">
          <div className="icon-chip icon-chip-amber">
            <AlertCircle size={18} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-primary">
              {t("{{count}} tenants without a subscription", { count: missingCount })}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {t(
                "These tenants have no plan and no feature access. Assign the Free plan to restore basic functionality.",
              )}
            </p>
          </div>
          <button
            onClick={() => backfill.mutate()}
            disabled={backfill.isPending}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 active:scale-[0.98] transition disabled:opacity-60 shrink-0"
          >
            <Wand2 size={14} />
            {backfill.isPending
              ? t("Fixing…")
              : t("Backfill Free plan ({{missingCount}})", { missingCount })}
          </button>
        </div>
      )}

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              {COLS.map((h, i) => (
                <th key={h || `c${i}`} className={i === COLS.length - 1 ? "text-right" : ""}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonRows />}
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
                <td colSpan={COLS.length} className="!py-12 text-center">
                  <Search size={24} className="mx-auto mb-2 text-muted opacity-60" />
                  <p className="text-sm font-medium text-secondary">
                    {search
                      ? t("No active tenants match your search.")
                      : t("No active tenants yet.")}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-soft">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-secondary hover:bg-[rgb(var(--ink)/0.04)] transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                {t("Deactivated history ({{inactiveCount}})", { inactiveCount: inactive.length })}
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="data-table border-t border-soft">
                <tbody>
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
