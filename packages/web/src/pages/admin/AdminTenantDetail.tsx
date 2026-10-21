import { ProvisioningBadge, ProvisioningPanel } from "../../components/admin/Provisioning";
import TenantBackupLoad from "../../components/admin/TenantBackupLoad";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { adminService } from "../../services/AdminService";
import { format } from "date-fns";
import { roleLabel } from "@rice-mill/shared";
import ActivityLogList from "../../components/activity/ActivityLogList";
import Select from "../../components/Select";
import DatePicker from "../../components/DatePicker";
import type { ActivityRow } from "../../components/activity/format";
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
  Star,
  AlertCircle,
  Infinity as InfinityIcon,
  Calendar,
  CalendarOff,
  CircleSlash,
  CheckCircle2,
  Clock,
  ScrollText,
} from "lucide-react";

/* ─── Plan icon helper ─── */
function PlanIcon({ code, size = 18 }: { code: string; size?: number }) {
  if (code === "enterprise") return <Crown size={size} />;
  if (code === "pro") return <Zap size={size} />;
  if (code === "basic") return <Star size={size} />;
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

/* ─── Per-user activity log (warehouse delete/restore/purge) ─── */
function TenantActivityLog({ tenantId }: { tenantId: string }) {
  const { data: rows = [], isLoading } = useQuery<ActivityRow[]>({
    queryKey: ["admin-tenant-activity", tenantId],
    queryFn: () => adminService.getTenantActivity(tenantId),
    enabled: !!tenantId,
  });
  return <ActivityLogList rows={rows} loading={isLoading} />;
}

const ACCEPTANCE_METHOD: Record<string, string> = {
  signup: "At sign-up",
  gate: "At sign-in",
  invite: "Added by the Boss",
};

/* ─── Terms-acceptance ledger: who agreed to which terms, read-only ─── */
function TenantLegalLedger({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenant-legal", tenantId],
    queryFn: () => adminService.getTenantLegalAcceptances(tenantId),
    enabled: !!tenantId,
  });
  const rows = data?.acceptances ?? [];
  const pending = data?.not_accepted_current ?? [];
  return (
    <div className="panel">
      <div className="px-6 py-4 border-b border-soft">
        <div className="flex items-center gap-2">
          <ScrollText size={16} className="text-muted" />
          <h3 className="font-semibold text-primary">Terms acceptance ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted mt-1">
          Every time someone at this mill agreed to the terms: which version, a fingerprint of the
          exact text they were shown, how, when and from where. These records can't be changed.
          {data && (
            <>
              {" "}
              Current version: <span className="font-mono">{data.agreement_version}</span>.
            </>
          )}
        </p>
      </div>
      {pending.length > 0 && (
        <div className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p>
            Haven't accepted the current terms yet:{" "}
            {pending.map((u) => u.full_name || u.username).join(", ")}. They're asked at their next
            sign-in.
          </p>
        </div>
      )}
      <table className="data-table">
        <thead>
          <tr>
            {["User", "Version", "How", "When", "From", "Fingerprint"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3">
                <span className="font-medium">{r.full_name || "—"}</span>
                <span className="block font-mono text-xs text-muted">{r.username || "—"}</span>
              </td>
              <td className="px-4 py-3 font-mono text-xs">{r.agreement_version}</td>
              <td className="px-4 py-3">{ACCEPTANCE_METHOD[r.method] ?? r.method}</td>
              <td className="px-4 py-3 text-xs text-muted" title={r.accepted_at}>
                {format(new Date(r.accepted_at), "MMM d, yyyy HH:mm")}
              </td>
              <td
                className="px-4 py-3 font-mono text-xs text-muted"
                title={r.user_agent ?? undefined}
              >
                {r.ip_address || "—"}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted" title={r.content_hash}>
                {r.content_hash.slice(0, 12)}…
              </td>
            </tr>
          ))}
          {!isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-muted">
                No acceptances recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Tier dropdown options ─── */
const TIER_OPTIONS: { value: string; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "basic", label: "Basic" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
  { value: "trial", label: "Trial (7 days)" },
];

/* Default trial duration. Admin can override the expires_at field if needed. */
const DEFAULT_TRIAL_DAYS = 7;

/** Format a Date as a date input value (yyyy-MM-dd) in local time. */
function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a yyyy-MM-dd string and return a Date set to 23:59:59 local time. */
function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr + "T23:59:59");
  return d;
}

/** "in 4 days" / "in 2 hours" / "expired 3 days ago" — short and human. */
function relativeTo(now: Date, then: Date): string {
  const diffMs = then.getTime() - now.getTime();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const unit =
    days >= 1
      ? `${days} day${days === 1 ? "" : "s"}`
      : hours >= 1
        ? `${hours} hour${hours === 1 ? "" : "s"}`
        : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return past ? `${unit} ago` : `in ${unit}`;
}

/* ─── Subscription Indicator: at-a-glance "is it active, which plan, since when, until when" ─── */
function SubscriptionIndicator({ sub }: { sub: any | null | undefined }) {
  if (!sub) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3">
        <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold">No subscription assigned</p>
          <p className="text-amber-800 dark:text-amber-200 mt-0.5">
            This tenant has no feature access until you activate a tier below.
          </p>
        </div>
      </div>
    );
  }

  const status: string = sub.status;
  const isActive = status === "active";
  const isTrial = status === "trial";
  const isExpired = status === "expired" || status === "cancelled";

  const banner = isActive
    ? {
        wrap: "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30",
        icon: <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />,
        title: "Active subscription",
        titleClass: "text-emerald-900 dark:text-emerald-200",
      }
    : isTrial
      ? {
          wrap: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30",
          icon: <Clock size={20} className="text-blue-600 dark:text-blue-400" />,
          title: "Trial in progress",
          titleClass: "text-blue-900 dark:text-blue-200",
        }
      : isExpired
        ? {
            wrap: "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30",
            icon: <CircleSlash size={20} className="text-rose-600 dark:text-rose-400" />,
            title: status === "cancelled" ? "Subscription cancelled" : "Subscription expired",
            titleClass: "text-rose-900 dark:text-rose-200",
          }
        : {
            wrap: "border-soft bg-surface-muted",
            icon: <AlertCircle size={20} className="text-muted" />,
            title: status.replace(/_/g, " "),
            titleClass: "text-primary",
          };

  const started = sub.started_at ? new Date(sub.started_at) : null;
  const expires = sub.expires_at ? new Date(sub.expires_at) : null;
  const now = new Date();

  return (
    <div className={`rounded-xl border ${banner.wrap}`}>
      {/* Banner: status + plan + price on one row */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {banner.icon}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${banner.titleClass}`}>{banner.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <PlanIcon code={sub.plan_code} size={14} />
            <span className="text-lg font-bold text-primary">{sub.plan_name}</span>
            <span className="text-xs text-muted">
              {sub.monthly_price === 0 ? "Free" : `₱${sub.monthly_price.toLocaleString()}/mo`}
            </span>
            {sub.max_users && (
              <span className="text-xs text-muted">
                · {sub.max_users} users · {sub.max_branches || "∞"} branches
              </span>
            )}
          </div>
        </div>
        <span className={statusBadge(status)}>{status}</span>
      </div>

      {/* Facts grid: Started / Until */}
      <div className="grid grid-cols-1 sm:grid-cols-2 border-t border-current/10 bg-[rgb(var(--surface)/0.5)]">
        <div className="px-4 py-3 sm:border-r border-soft">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            <Calendar size={11} /> Started
          </div>
          <div className="text-sm font-medium text-primary mt-1">
            {started ? format(started, "MMM d, yyyy") : "—"}
          </div>
          {started && <div className="text-xs text-muted">{relativeTo(now, started)}</div>}
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {expires ? <CalendarOff size={11} /> : <InfinityIcon size={11} />} Until
          </div>
          {expires ? (
            <>
              <div className="text-sm font-medium text-primary mt-1">
                {format(expires, "MMM d, yyyy")}
              </div>
              <div
                className={`text-xs ${
                  expires < now ? "text-rose-600 dark:text-rose-400 font-medium" : "text-muted"
                }`}
              >
                {expires < now ? "expired " : ""}
                {relativeTo(now, expires)}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-primary mt-1">Never — permanent</div>
              <div className="text-xs text-muted">No expiration set</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Subscription Management Card ─── */
function SubscriptionManager({ tenantId, tenantName }: { tenantId: string; tenantName?: string }) {
  const qc = useQueryClient();

  /* Fetch available plans */
  const { data: plans = [] } = useQuery<any[]>({
    queryKey: ["admin-plans"],
    queryFn: () => adminService.getPlans(),
  });

  /* Fetch current subscription */
  const { data: subData } = useQuery({
    queryKey: ["admin-tenant-sub", tenantId],
    queryFn: () => adminService.getTenantSubscription(tenantId),
    enabled: !!tenantId,
  });

  const currentSub = subData?.subscription;

  /* Local form state — synced once data loads */
  const [tier, setTier] = useState<string>("free");
  const [trialOfCode, setTrialOfCode] = useState<string>("pro");
  const [expiresAt, setExpiresAt] = useState("");
  const [isPermanent, setIsPermanent] = useState(false);
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastSyncKeyRef = useRef<string>("");

  /* Sync local form only when fetched subscription payload actually changes */
  useEffect(() => {
    const syncKey = currentSub
      ? `${tenantId}:${currentSub.id}:${currentSub.plan_code}:${currentSub.status}:${currentSub.expires_at ?? ""}:${currentSub.notes ?? ""}`
      : `${tenantId}:none`;
    if (lastSyncKeyRef.current === syncKey) return;
    lastSyncKeyRef.current = syncKey;

    if (currentSub) {
      if (currentSub.status === "trial") {
        setTier("trial");
        setTrialOfCode(currentSub.plan_code);
      } else {
        setTier(currentSub.plan_code);
      }
      setExpiresAt(currentSub.expires_at ? currentSub.expires_at.slice(0, 10) : "");
      // Permanent = active subscription with no expiry. Trials are never permanent.
      setIsPermanent(currentSub.status !== "trial" && !currentSub.expires_at);
      setNotes(currentSub.notes || "");
      return;
    }
    setTier("free");
    setTrialOfCode("pro");
    const def = new Date();
    def.setDate(def.getDate() + 30);
    setExpiresAt(toDateInput(def));
    setIsPermanent(false);
    setNotes("");
  }, [tenantId, currentSub]);

  /* When the admin picks a tier, auto-fill expires_at with sensible defaults. */
  const handleTierChange = (newTier: string) => {
    setTier(newTier);
    if (newTier === "trial") {
      setIsPermanent(false);
      const end = new Date();
      end.setDate(end.getDate() + DEFAULT_TRIAL_DAYS);
      setExpiresAt(toDateInput(end));
    } else if (!isPermanent && !expiresAt) {
      const end = new Date();
      end.setDate(end.getDate() + 30);
      setExpiresAt(toDateInput(end));
    }
  };

  const handlePermanentChange = (checked: boolean) => {
    setIsPermanent(checked);
    if (checked) {
      // Permanent = no expiry. Clear the date field.
      setExpiresAt("");
    }
  };

  /* Mutation to assign/update subscription. Writes the PUT response directly into the
     query cache so the UI reflects the new plan instantly, not on the next poll. */
  const save = useMutation({
    mutationFn: (payload: any) => adminService.assignTenantSubscription(tenantId, payload),
    onSuccess: (response: any) => {
      if (response?.subscription) {
        qc.setQueryData(["admin-tenant-sub", tenantId], {
          company_id: tenantId,
          subscription: response.subscription,
        });
      }
      qc.invalidateQueries({ queryKey: ["admin-tenant-sub", tenantId] });
      qc.invalidateQueries({ queryKey: ["admin-tenant", tenantId] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      setSaved(true);
      setShowForm(false);
      setTimeout(() => setSaved(false), 3500);
    },
  });

  const findPlanByCode = (code: string) => plans.find((p: any) => p.code === code);

  const planIdForTier = (t: string): string | undefined => {
    if (t === "trial") {
      return findPlanByCode(trialOfCode)?.id;
    }
    return findPlanByCode(t)?.id;
  };

  const handleSave = () => {
    setSaved(false);
    const plan_id = planIdForTier(tier);
    if (!plan_id) return;
    const status = tier === "trial" ? "trial" : "active";

    let expiresAtIso: string | null = null;
    if (status === "trial") {
      // Trial: always has an end date; default to 7 days from now if blank.
      if (expiresAt) {
        expiresAtIso = endOfDay(expiresAt).toISOString();
      } else {
        const def = new Date();
        def.setDate(def.getDate() + DEFAULT_TRIAL_DAYS);
        expiresAtIso = endOfDay(toDateInput(def)).toISOString();
      }
    } else if (!isPermanent) {
      // Active non-permanent — use picked date at 23:59:59; default to 30 days if blank.
      if (expiresAt) {
        expiresAtIso = endOfDay(expiresAt).toISOString();
      } else {
        const def = new Date();
        def.setDate(def.getDate() + 30);
        expiresAtIso = endOfDay(toDateInput(def)).toISOString();
      }
    }

    save.mutate({
      plan_id,
      status,
      expires_at: expiresAtIso,
      trial_ends_at: status === "trial" ? expiresAtIso : null,
      notes: notes || null,
    });
  };

  const saveErrorMessage =
    typeof (save.error as any)?.response?.data?.detail === "string"
      ? (save.error as any).response.data.detail
      : "Failed to save. Please try again.";

  const selectedPlan = tier === "trial" ? findPlanByCode(trialOfCode) : findPlanByCode(tier);

  const buttonLabel = save.isPending
    ? tier === "trial"
      ? "Starting trial…"
      : "Activating…"
    : tier === "trial"
      ? currentSub?.status === "trial"
        ? "Save trial"
        : "Start trial"
      : currentSub && currentSub.status === "active" && currentSub.plan_code === tier
        ? "Save changes"
        : "Activate subscription";

  return (
    <div className="panel">
      {/* Header */}
      <div className="px-6 py-4 border-b border-soft flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-muted" />
          <h3 className="font-semibold text-primary">Subscription</h3>
        </div>
        {!showForm && currentSub && (
          <button onClick={() => setShowForm(true)} className="link text-xs">
            Change tier
          </button>
        )}
      </div>

      {/* Current plan indicator — answers: is it active, which plan, since when, until when */}
      <div className="px-6 py-4">
        <SubscriptionIndicator sub={currentSub} />
      </div>

      {/* Tier picker + options */}
      {(showForm || !currentSub) && (
        <div className="px-6 pb-6 space-y-5 border-t border-soft pt-5">
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              Subscription tier
            </label>
            <Select
              aria-label="Subscription tier"
              value={tier}
              onChange={handleTierChange}
              options={TIER_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            />
            <p className="text-xs text-muted mt-1">
              Picking a tier activates it for this tenant.{" "}
              <span className="font-medium">Trial</span> defaults to {DEFAULT_TRIAL_DAYS} days
              (adjust the expiry below to change).
            </p>
          </div>

          {tier === "trial" && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                Trial of which plan?
              </label>
              <Select
                aria-label="Trial of which plan?"
                value={trialOfCode}
                onChange={setTrialOfCode}
                options={plans
                  .filter((p: any) => p.is_active && p.code !== "free")
                  .map((p: any) => ({
                    value: p.code,
                    label: `${p.name} (${
                      p.monthly_price === 0 ? "Free" : `₱${p.monthly_price.toLocaleString()}/mo`
                    })`,
                  }))}
              />
              <p className="text-xs text-muted mt-1">
                Tenant gets all of this plan's features for the trial duration.
              </p>
            </div>
          )}

          {/* Selected tier details */}
          {selectedPlan && (
            <div className="rounded-xl border border-soft bg-surface-muted p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <PlanIcon code={selectedPlan.code} />
                <span className="font-bold text-primary">{selectedPlan.name}</span>
                {tier === "trial" && (
                  <span className="ml-1 inline-flex items-center text-[10px] font-bold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded">
                    Trial
                  </span>
                )}
              </div>
              <span className="text-secondary">
                {selectedPlan.monthly_price === 0
                  ? "Free"
                  : `₱${selectedPlan.monthly_price.toLocaleString()}/mo`}
              </span>
              <span className="text-secondary">
                {selectedPlan.max_users ? `${selectedPlan.max_users} users` : "Unlimited users"} ·{" "}
                {selectedPlan.max_branches
                  ? `${selectedPlan.max_branches} branches`
                  : "Unlimited branches"}
              </span>
              {Array.isArray(selectedPlan.features) && (
                <div className="basis-full flex flex-wrap gap-1.5 pt-1">
                  {(selectedPlan.features as string[]).map((f) => (
                    <span
                      key={f}
                      className="bg-surface border border-soft text-secondary text-[10px] px-1.5 py-0.5 rounded"
                    >
                      {f.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Permanent toggle (active tiers only) */}
          {tier !== "trial" && (
            <label className="flex items-start gap-2 rounded-lg border border-soft bg-surface-muted px-3 py-2.5 cursor-pointer hover:bg-[rgb(var(--ink)/0.04)] transition-colors">
              <input
                type="checkbox"
                checked={isPermanent}
                onChange={(e) => handlePermanentChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line accent-emerald-600 focus:ring-emerald-500"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <InfinityIcon size={14} />
                  Permanent subscription
                </span>
                <span className="text-xs text-muted">
                  Never expires. Tenant keeps access until you change the tier.
                </span>
              </span>
            </label>
          )}

          {/* Expiry + notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                {tier === "trial"
                  ? "Trial ends at"
                  : isPermanent
                    ? "Expires at (disabled — permanent)"
                    : "Expires at"}
              </label>
              <DatePicker
                aria-label={tier === "trial" ? "Trial ends at" : "Expires at"}
                value={expiresAt}
                onChange={setExpiresAt}
                disabled={tier !== "trial" && isPermanent}
              />
              {tier === "trial" && (
                <p className="text-xs text-muted mt-1">
                  Defaulted to {DEFAULT_TRIAL_DAYS} days from now. Tenant loses access automatically
                  when this passes.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                Notes (optional)
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
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleSave}
                disabled={save.isPending || plans.length === 0}
                className="btn-primary"
              >
                {save.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> {buttonLabel}
                  </>
                ) : (
                  <>
                    <Check size={14} /> {buttonLabel}
                  </>
                )}
              </button>
              {currentSub && (
                <button
                  onClick={() => setShowForm(false)}
                  className="btn-secondary"
                  disabled={save.isPending}
                >
                  Cancel
                </button>
              )}
              {save.isError && (
                <span className="text-sm text-rose-600 dark:text-rose-400">{saveErrorMessage}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {saved && (
        <div className="mx-6 mb-6 text-sm bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
          <Check size={14} className="mt-0.5 shrink-0" />
          <span>
            Subscription saved for <strong>{tenantName || "this tenant"}</strong>. Their session
            reflects the new tier within ~10 seconds (or instantly when they refocus their tab).
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Empty placeholders so the page renders immediately, no spinner ─── */
const EMPTY_COMPANY = {
  id: "",
  name: "",
  address: "",
  tin: "",
  nfa_license_no: "",
  da_registration_no: "",
  phone: "",
  email: "",
  currency: "PHP",
  timezone: "Asia/Manila",
  is_multi_branch: false,
  is_active: true,
  created_at: null as string | null,
};
const EMPTY_METRICS = {
  purchases_count: 0,
  batches_count: 0,
  orders_count: 0,
  invoices_count: 0,
  total_revenue: 0,
  total_expenses: 0,
};

/* ─── Main Page ─── */
export default function AdminTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-tenant", id],
    queryFn: () => adminService.getTenant(id!),
    enabled: !!id,
    placeholderData: (prev) => prev,
  });

  const toggle = useMutation({
    mutationFn: (is_active: boolean) => adminService.setTenantActive(id!, is_active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant", id] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  const c = data?.company || EMPTY_COMPANY;
  const m = data?.metrics || EMPTY_METRICS;
  const users = (data?.users as any[]) || [];
  const branches = (data?.branches as any[]) || [];

  return (
    <div className="space-y-6">
      <Link
        to="/admin/tenants"
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-primary transition-colors"
      >
        <ArrowLeft size={14} /> Back to tenants
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
              <Building2 size={22} /> {c.name || "Tenant"}
            </h2>
            {c.is_active ? (
              <span className="badge-green">Active</span>
            ) : (
              <span className="badge-red">Inactive</span>
            )}
            <ProvisioningBadge info={c.provisioning} />
          </div>
          <p className="text-sm text-muted mt-1">
            Tenant ID: <span className="font-mono">{c.id || id}</span>
          </p>
        </div>
        {data && (
          <button
            onClick={() => toggle.mutate(!c.is_active)}
            disabled={toggle.isPending}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm ${
              c.is_active
                ? "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40"
                : "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
            }`}
            title={
              c.is_active
                ? "Deactivate this tenant — blocks all logins"
                : "Activate this tenant — restores login"
            }
          >
            <Power size={14} />
            {toggle.isPending ? "Saving…" : c.is_active ? "Deactivate tenant" : "Activate tenant"}
          </button>
        )}
      </div>

      {id && <ProvisioningPanel tenantId={id} info={c.provisioning} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* ─── Subscription Management ─── */}
          <SubscriptionManager tenantId={id!} tenantName={c.name} />

          <div className="card">
            <h3 className="font-semibold text-primary mb-4">Company information</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">Address</dt>
                <dd className="text-primary">{c.address || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">TIN</dt>
                <dd className="text-primary">{c.tin || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Phone</dt>
                <dd className="text-primary">{c.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Email</dt>
                <dd className="text-primary">{c.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">NFA License</dt>
                <dd className="text-primary">{c.nfa_license_no || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">DA Reg.</dt>
                <dd className="text-primary">{c.da_registration_no || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Currency</dt>
                <dd className="text-primary">{c.currency}</dd>
              </div>
              <div>
                <dt className="text-muted">Timezone</dt>
                <dd className="text-primary">{c.timezone}</dd>
              </div>
              <div>
                <dt className="text-muted">Multi-branch</dt>
                <dd className="text-primary">{c.is_multi_branch ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-muted">Signed up</dt>
                <dd className="text-primary">
                  {c.created_at ? format(new Date(c.created_at), "MMM d, yyyy 'at' HH:mm") : "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="panel">
            <div className="px-6 py-4 border-b border-soft flex items-center gap-2">
              <UsersIcon size={16} className="text-muted" />
              <h3 className="font-semibold text-primary">Users ({users.length})</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  {[
                    "Username",
                    "Full name",
                    "Email",
                    "Role",
                    "Status",
                    "Created",
                    "Last login",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-3">{u.full_name}</td>
                    <td className="px-4 py-3 text-muted">{u.email || "—"}</td>
                    <td className="px-4 py-3">{roleLabel(u.role) || "—"}</td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="badge-green">Active</span>
                      ) : (
                        <span className="badge-red">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">
                      {u.created_at ? format(new Date(u.created_at), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">
                      {u.last_login ? format(new Date(u.last_login), "MMM d, HH:mm") : "—"}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <TenantLegalLedger tenantId={id!} />

          <div className="panel">
            <div className="px-6 py-4 border-b border-soft flex items-center gap-2">
              <MapPin size={16} className="text-muted" />
              <h3 className="font-semibold text-primary">Branches ({branches.length})</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  {["Name", "Type", "Status"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branches.map((b: any) => (
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
                {branches.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted">
                      No branches yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <TenantBackupLoad tenantId={id!} tenantName={c.name} />

          <div className="card">
            <h3 className="font-semibold text-primary mb-1">Activity log</h3>
            <p className="text-xs text-muted mb-3">
              Who did what, newest first: accounts added, removed or re-roled, sign-in and password
              events, and warehouse deletes.
            </p>
            <TenantActivityLog tenantId={id!} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold text-primary mb-4">Activity</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Purchases</dt>
                <dd className="font-semibold">{m.purchases_count.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Milling batches</dt>
                <dd className="font-semibold">{m.batches_count.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Sales orders</dt>
                <dd className="font-semibold">{m.orders_count.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Invoices</dt>
                <dd className="font-semibold">{m.invoices_count.toLocaleString()}</dd>
              </div>
            </dl>
          </div>

          <div className="card">
            <h3 className="font-semibold text-primary mb-4">Money</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Revenue</dt>
                <dd className="font-semibold text-emerald-600 dark:text-emerald-400">
                  ₱{m.total_revenue.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Expenses</dt>
                <dd className="font-semibold text-rose-600 dark:text-rose-400">
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
