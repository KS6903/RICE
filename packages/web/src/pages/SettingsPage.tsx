import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { billingService } from "../services/BillingService";
import { branchesService } from "../services/BranchesService";
import { activityService } from "../services/ActivityService";
import { authService } from "../services/AuthService";
import { paddyService } from "../services/PaddyService";
import { millingService } from "../services/MillingService";
import { costsService } from "../services/CostsService";
import { useAuthStore } from "../stores/authStore";
import {
  Building2,
  MapPin,
  User as UserIcon,
  KeyRound,
  Plus,
  Wheat,
  Factory,
  Receipt,
  Power,
  History,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Check,
  X as XIcon,
  Crown,
  Zap,
  Rocket,
  Star,
  Loader2,
  Clock,
  AlertCircle,
  Settings as SettingsIcon,
  CheckCircle2,
  XCircle,
  Pencil,
  ShieldCheck,
  MonitorSmartphone,
  LogOut,
} from "lucide-react";
import { format } from "date-fns";
import { useCurrentPlan } from "../hooks/useFeature";
import type { SubscriptionPlan, UpgradeRequest } from "@rice-mill/shared";
import ActivityLogList from "../components/activity/ActivityLogList";
import BackupCodes from "../components/BackupCodes";
import type { ActivityRow } from "../components/activity/format";
import { Trash2, RotateCcw } from "lucide-react";

type Tab =
  | "billing"
  | "company"
  | "branches"
  | "varieties"
  | "equipment"
  | "categories"
  | "activity"
  | "profile"
  | "password"
  | "sessions";

const LABEL = "block text-sm font-semibold text-secondary mb-1.5";
const TABLE_HEAD =
  "px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

export default function SettingsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isManager = role === "owner" || role === "admin";
  // Non-managers (cashier, encoder, mill_operator, accountant) only manage their
  // own account — everything else here is an owner/admin surface.
  const [tab, setTab] = useState<Tab>(isManager ? "billing" : "profile");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    // Company/management settings — owners & admins only.
    ...(isManager
      ? [
          { key: "billing" as Tab, label: "Billing", icon: CreditCard },
          { key: "company" as Tab, label: "Company", icon: Building2 },
          { key: "branches" as Tab, label: "Branches", icon: MapPin },
          { key: "varieties" as Tab, label: "Rice Varieties", icon: Wheat },
          { key: "equipment" as Tab, label: "Equipment", icon: Factory },
          { key: "categories" as Tab, label: "Expense Categories", icon: Receipt },
          { key: "activity" as Tab, label: "Activity Log", icon: History },
        ]
      : []),
    // Personal settings — available to every role.
    { key: "profile", label: "My Profile", icon: UserIcon },
    { key: "password", label: "Password", icon: KeyRound },
    { key: "sessions", label: "Devices", icon: MonitorSmartphone },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <SettingsIcon size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Settings</h2>
          <p className="text-sm text-secondary">Manage your account and platform preferences</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <aside className="w-full md:w-64 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto pb-4 md:pb-0 -mx-1 md:mx-0 px-1">
            {tabs.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`group relative flex items-center gap-3 px-3.5 py-2.5 text-sm font-semibold rounded-xl transition-all whitespace-nowrap ${
                    active
                      ? "glass text-primary shadow-sm"
                      : "text-secondary hover:text-primary hover:bg-slate-100/60 dark:hover:bg-slate-600/15"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-grad-brand" />
                  )}
                  <Icon
                    size={17}
                    className={
                      active
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted group-hover:text-secondary"
                    }
                  />
                  {label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 max-w-4xl">
          {tab === "billing" && <BillingTab />}
          {tab === "company" && <CompanyTab />}
          {tab === "branches" && <BranchesTab />}
          {tab === "varieties" && <VarietiesTab />}
          {tab === "equipment" && <EquipmentTab />}
          {tab === "categories" && <CategoriesTab />}
          {tab === "activity" && <ActivityTab />}
          {tab === "profile" && <ProfileTab />}
          {tab === "password" && <PasswordTab />}
          {tab === "sessions" && <SessionsTab />}
        </main>
      </div>
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
  canva_inventory: "Visual Warehouse canva (spatial inventory)",
};

const ALL_FEATURE_KEYS = Object.keys(FEATURE_LABELS);

function planIcon(code: string, size = 16) {
  if (code === "enterprise") return <Crown size={size} />;
  if (code === "pro") return <Zap size={size} />;
  if (code === "basic") return <Star size={size} />;
  return <Rocket size={size} />;
}

function getSeenRequests(): string[] {
  try {
    return JSON.parse(localStorage.getItem("rice-mill-seen-requests") || "[]");
  } catch {
    return [];
  }
}
function markRequestSeen(id: string) {
  const seen = getSeenRequests();
  if (!seen.includes(id))
    localStorage.setItem("rice-mill-seen-requests", JSON.stringify([...seen, id]));
}

function ResolvedNotice({ request, onDone }: { request: UpgradeRequest; onDone: () => void }) {
  const [visible, setVisible] = useState(true);
  const approved = request.status === "approved";

  useEffect(() => {
    markRequestSeen(request.id);
    const fade = setTimeout(() => setVisible(false), 4000);
    const remove = setTimeout(() => onDone(), 4600);
    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, [request.id, onDone]);

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm border transition-all duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
      } ${
        approved
          ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/60"
          : "bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800/60"
      }`}
    >
      {approved ? (
        <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
      ) : (
        <XCircle size={18} className="text-rose-600 dark:text-rose-400 shrink-0" />
      )}
      <p
        className={`text-sm font-semibold ${approved ? "text-emerald-900 dark:text-emerald-100" : "text-rose-900 dark:text-rose-100"}`}
      >
        {approved
          ? `Your upgrade to ${request.requested_plan_name} has been approved.`
          : `Your upgrade to ${request.requested_plan_name} was not approved.`}
        {request.admin_note && (
          <span className="ml-1 font-normal opacity-80">— {request.admin_note}</span>
        )}
      </p>
    </div>
  );
}

function BillingTab() {
  const qc = useQueryClient();
  const plan = useCurrentPlan();
  const user = useAuthStore((s) => s.user);
  const features = (user?.features as string[] | undefined) || [];
  const canRequest = user?.role === "owner" || user?.role === "admin";
  const isOnPaidPlan =
    !!plan && plan.monthly_price > 0 && (plan.status === "active" || plan.status === "trial");
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => getSeenRequests());

  const { data: plans = [] } = useQuery<SubscriptionPlan[]>({
    queryKey: ["billing-plans"],
    queryFn: () => billingService.getPlans(),
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const { data: requestData } = useQuery<{ request: UpgradeRequest | null }>({
    queryKey: ["billing-my-request"],
    queryFn: () => billingService.getMyRequest(),
    refetchInterval: 10 * 1000,
    refetchOnWindowFocus: true,
  });
  const myRequest = requestData?.request ?? null;
  const pendingRequest = myRequest && myRequest.status === "pending" ? myRequest : null;
  const resolvedRequest =
    myRequest && myRequest.status !== "pending" && myRequest.resolved_at ? myRequest : null;
  const recentResolved =
    resolvedRequest && !dismissedIds.includes(resolvedRequest.id) ? resolvedRequest : null;

  const dismissResolved = () => {
    if (!resolvedRequest) return;
    markRequestSeen(resolvedRequest.id);
    setDismissedIds((prev) => [...prev, resolvedRequest.id]);
  };

  const requestUpgrade = useMutation({
    mutationFn: (plan_id: string) =>
      billingService.createUpgradeRequest({
        plan_id,
        request_type: isOnPaidPlan ? "change" : "upgrade",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-my-request"] });
    },
  });

  const cancelRequest = useMutation({
    mutationFn: (id: string) => billingService.cancelUpgradeRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-my-request"] });
    },
  });

  if (!plan) {
    return (
      <div className="card text-sm text-secondary">
        No subscription on file. Contact your platform administrator.
      </div>
    );
  }

  const cardGradient =
    plan.code === "enterprise"
      ? "from-purple-700 via-fuchsia-700 to-pink-700"
      : plan.code === "pro"
        ? "from-indigo-700 via-blue-700 to-cyan-700"
        : plan.code === "basic"
          ? "from-sky-700 via-blue-700 to-indigo-700"
          : "from-slate-700 via-slate-800 to-slate-900";

  const statusDot =
    plan.status === "active" || plan.status === "trial"
      ? "bg-emerald-400"
      : plan.status === "expired" || plan.status === "past_due"
        ? "bg-rose-400"
        : "bg-amber-400";

  const requestErrorMessage =
    typeof (requestUpgrade.error as any)?.response?.data?.detail === "string"
      ? (requestUpgrade.error as any).response.data.detail
      : null;

  return (
    <div className="space-y-5">
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${cardGradient} p-6 sm:p-8 text-white shadow-lg`}
      >
        <div
          className="absolute -top-16 -right-16 w-64 h-64 bg-white dark:bg-slate-800 opacity-10 rounded-full blur-3xl pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute -bottom-12 -left-12 w-48 h-48 bg-white dark:bg-slate-800 opacity-5 rounded-full blur-3xl pointer-events-none"
          aria-hidden
        />

        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-wide uppercase text-white/75">Current plan</p>
            <div className="flex items-baseline gap-3 mt-1.5 flex-wrap">
              <h3 className="text-3xl font-extrabold tracking-tight">{plan.name}</h3>
              <span className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
                {plan.code}
              </span>
            </div>
            <p className="text-white/85 mt-2 font-medium">
              {plan.monthly_price > 0
                ? `₱${plan.monthly_price.toLocaleString()}/month`
                : "Free forever"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-white/75">Status</p>
            <p className="text-sm font-bold capitalize mt-1 flex items-center justify-end gap-1.5">
              <span className={`w-2 h-2 rounded-full ${statusDot}`} />
              {plan.status}
            </p>
          </div>
        </div>

        {/* Expiry strip */}
        {(() => {
          if (!plan.expires_at) {
            return (
              <div className="relative mt-5 flex items-center gap-2 rounded-xl bg-white/10 ring-1 ring-white/20 px-4 py-2.5 text-sm text-white/90">
                <Clock size={14} className="shrink-0" />
                <span className="font-medium">Permanent subscription — no expiry</span>
              </div>
            );
          }
          const expDate = new Date(plan.expires_at);
          const daysLeft = Math.ceil((expDate.getTime() - Date.now()) / 86400000);
          const expired = daysLeft <= 0;
          const urgent = daysLeft <= 7 && !expired;
          return (
            <div
              className={`relative mt-5 flex items-center justify-between gap-4 rounded-xl px-4 py-2.5 text-sm ring-1 ${
                expired
                  ? "bg-rose-500/30 ring-rose-300/50 text-white"
                  : urgent
                    ? "bg-amber-400/30 ring-amber-300/50 text-white"
                    : "bg-white/10 ring-white/20 text-white/90"
              }`}
            >
              <div className="flex items-center gap-2">
                <Clock size={14} className="shrink-0" />
                <span className="font-medium">
                  {expired ? "Subscription expired" : "Expires on "}
                  <span className="font-bold">{!expired && format(expDate, "MMMM d, yyyy")}</span>
                </span>
              </div>
              {!expired && (
                <span
                  className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
                    urgent ? "bg-white/25 text-white" : "bg-white/15 text-white/90"
                  }`}
                >
                  {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                </span>
              )}
            </div>
          );
        })()}

        <div className="relative grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-white/20 text-sm">
          <div>
            <p className="text-white/75 font-medium">User limit</p>
            <p className="font-bold text-lg mt-0.5">{plan.max_users ?? "Unlimited"}</p>
          </div>
          <div>
            <p className="text-white/75 font-medium">Branch limit</p>
            <p className="font-bold text-lg mt-0.5">{plan.max_branches ?? "Unlimited"}</p>
          </div>
        </div>
      </div>

      {pendingRequest &&
        (() => {
          const isPlanChange = pendingRequest.request_type === "change";
          return (
            <div className="rounded-2xl overflow-hidden shadow-md">
              <div className="bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock size={15} className="text-white" />
                  <span className="text-white text-xs font-bold uppercase tracking-wider">
                    {isPlanChange ? "Plan Change Requested" : "Upgrade Requested"}
                  </span>
                </div>
                {canRequest && (
                  <button
                    onClick={() => cancelRequest.mutate(pendingRequest.id)}
                    disabled={cancelRequest.isPending}
                    className="text-white/80 hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {cancelRequest.isPending ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>
              <div className="bg-white dark:bg-slate-900 px-4 py-3.5">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {isPlanChange ? "Change to " : "Upgrade to "}
                  <span className="text-indigo-600 dark:text-indigo-400">
                    {pendingRequest.requested_plan_name}
                  </span>
                  {pendingRequest.created_at && (
                    <span className="font-normal text-slate-400 text-sm">
                      {" "}
                      · {format(new Date(pendingRequest.created_at), "MMM d, yyyy")}
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {isPlanChange
                    ? "Awaiting admin approval. If approved, the new plan will take effect at the end of your current billing period."
                    : "Awaiting platform administrator approval."}
                </p>
              </div>
            </div>
          );
        })()}

      {!pendingRequest && recentResolved && (
        <ResolvedNotice request={recentResolved} onDone={dismissResolved} />
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-primary">Available plans</h3>
          {!canRequest && (
            <span className="text-xs font-medium text-muted">
              Only owners/admins can request upgrades
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => {
            const isCurrent = p.code === plan.code;
            const isPendingTarget = pendingRequest?.requested_plan_id === p.id;
            const planBorder: Record<string, string> = {
              free: "border-sky-300 dark:border-sky-700 hover:border-sky-400",
              basic: "border-cyan-300 hover:border-cyan-500",
              pro: "border-violet-400 hover:border-violet-500",
              enterprise: "border-amber-300 dark:border-amber-700 hover:border-amber-400",
            };
            const currentBorder: Record<string, string> = {
              free: "border-sky-500 ring-2 ring-sky-400/25",
              basic: "border-cyan-500 ring-2 ring-cyan-400/25",
              pro: "border-violet-500 ring-2 ring-violet-500/25",
              enterprise: "border-amber-500 ring-2 ring-amber-400/25",
            };
            const cardBg: Record<string, string> = {
              free: "bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/30 dark:to-slate-800/80",
              basic:
                "bg-gradient-to-br from-cyan-50 to-white dark:from-cyan-950/30 dark:to-slate-800/80",
              pro: "bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-slate-800/80",
              enterprise:
                "bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-800/80",
            };
            const ring = isCurrent
              ? (currentBorder[p.code] ?? "border-emerald-500 ring-2 ring-emerald-400/25")
              : (planBorder[p.code] ??
                "border-slate-300 dark:border-slate-600 hover:border-slate-400");
            const bg = cardBg[p.code] ?? "bg-white dark:bg-slate-800/70";
            const accentText: Record<string, string> = {
              free: "text-sky-600 dark:text-sky-400",
              basic: "text-cyan-600 dark:text-cyan-400",
              pro: "text-violet-600 dark:text-violet-400",
              enterprise: "text-amber-600 dark:text-amber-400",
            };
            const checkNeon: Record<string, string> = {
              free: "text-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.9)]",
              basic: "text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.9)]",
              pro: "text-violet-400 drop-shadow-[0_0_6px_rgba(167,139,250,0.9)]",
              enterprise: "text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.9)]",
            };
            const accent = accentText[p.code] ?? "text-emerald-600 dark:text-emerald-400";
            const checkColor =
              checkNeon[p.code] ?? "text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.9)]";
            return (
              <div
                key={p.id}
                className={`rounded-2xl border-2 p-5 flex flex-col transition-all ${ring} ${bg}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={accent}>{planIcon(p.code, 18)}</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{p.name}</span>
                  {isCurrent && <span className="ml-auto badge-green">Current</span>}
                </div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {p.monthly_price === 0 ? "Free" : `₱${p.monthly_price.toLocaleString()}`}
                  </span>
                  {p.monthly_price > 0 && (
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                      /mo
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200 mt-1 mb-2">
                  {p.description}
                </p>
                <div className="text-xs text-slate-700 dark:text-slate-300 font-semibold mb-3">
                  {p.max_users ? `${p.max_users} users` : "Unlimited users"} ·{" "}
                  {p.max_branches ? `${p.max_branches} branches` : "Unlimited branches"}
                </div>
                <ul className="text-sm text-slate-800 dark:text-slate-200 space-y-1.5 flex-1">
                  {(p.features || []).map((f) => (
                    <li key={f} className="flex items-center gap-1.5">
                      <Check size={14} className={`${checkColor} shrink-0`} />
                      {FEATURE_LABELS[f] || f.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <button disabled className="btn-secondary w-full opacity-70 cursor-default">
                      Your current plan
                    </button>
                  ) : p.code === "free" ? (
                    <button
                      disabled
                      className="btn-secondary w-full opacity-70 cursor-default"
                      title="Free is assigned automatically when your subscription ends — you can't request it."
                    >
                      Default plan
                    </button>
                  ) : isPendingTarget ? (
                    <button disabled className="btn-secondary w-full opacity-70 cursor-default">
                      Pending approval
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => requestUpgrade.mutate(p.id)}
                        disabled={!canRequest || requestUpgrade.isPending || !!pendingRequest}
                        className="btn-primary w-full"
                        title={
                          !canRequest
                            ? "Owner/admin role required"
                            : pendingRequest
                              ? "Cancel your pending request first"
                              : undefined
                        }
                      >
                        {requestUpgrade.isPending ? (
                          <>
                            <Loader2 size={14} className="animate-spin" /> Requesting…
                          </>
                        ) : isOnPaidPlan ? (
                          "Change Plan"
                        ) : (
                          `Get ${p.name}`
                        )}
                      </button>
                      {isOnPaidPlan && (
                        <p className="text-[11px] text-center text-slate-600 dark:text-slate-400 mt-1.5">
                          Takes effect at end of current billing period
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {requestErrorMessage && (
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400 mt-3">
            {requestErrorMessage}
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="text-lg font-bold text-primary mb-4">What's included in {plan.name}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {ALL_FEATURE_KEYS.map((key) => {
            const included = features.includes(key);
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                {included ? (
                  <Check size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <XIcon size={15} className="text-muted shrink-0" />
                )}
                <span className={included ? "text-primary font-medium" : "text-muted line-through"}>
                  {FEATURE_LABELS[key]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VarietyRow({ v, user, onToggle }: { v: any; user: any; onToggle: () => void }) {
  const isOwn = v.company_id === user?.company_id;
  return (
    <tr
      className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors ${
        !v.is_active ? "opacity-60" : ""
      }`}
    >
      <td className="px-4 py-3 font-mono text-xs text-secondary">{v.code}</td>
      <td className="px-4 py-3 font-semibold text-primary">{v.name}</td>
      <td className="px-4 py-3 capitalize text-secondary">{v.category || "—"}</td>
      <td className="px-4 py-3 text-secondary">
        {v.typical_recovery_pct ? `${v.typical_recovery_pct}%` : "—"}
      </td>
      <td className="px-4 py-3">
        {isOwn ? (
          <span className="badge-green">Custom</span>
        ) : (
          <span className="badge-gray">System</span>
        )}
      </td>
      <td className="px-4 py-3">
        {v.is_active ? (
          <span className="badge-green">Active</span>
        ) : (
          <span className="badge-red">Inactive</span>
        )}
      </td>
      <td className="px-4 py-3">
        {isOwn && (
          <button
            onClick={onToggle}
            className={`text-xs font-semibold inline-flex items-center gap-1 ${
              v.is_active
                ? "text-rose-600 dark:text-rose-400 hover:text-rose-700"
                : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
            }`}
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
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "inbred",
    typical_recovery_pct: "",
  });

  const { data: varieties = [] } = useQuery({
    queryKey: ["varieties-all"],
    queryFn: () => paddyService.listVarieties(true),
  });
  const active = varieties.filter((v: any) => v.is_active);
  const inactive = varieties.filter((v: any) => !v.is_active);

  const create = useMutation({
    mutationFn: (b: typeof form) =>
      paddyService.createVariety({
        ...b,
        typical_recovery_pct: b.typical_recovery_pct ? parseFloat(b.typical_recovery_pct) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["varieties-all"] });
      qc.invalidateQueries({ queryKey: ["varieties"] });
      setShowForm(false);
      setForm({ code: "", name: "", category: "inbred", typical_recovery_pct: "" });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      paddyService.updateVariety(id, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["varieties-all"] });
      qc.invalidateQueries({ queryKey: ["varieties"] });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Add custom rice varieties for your company. System varieties (NSIC Rc222 etc.) are shared
        across all clients but can't be modified.
      </p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add variety
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">New variety</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Code *</label>
              <input
                className="input"
                placeholder="e.g. RC400"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <label className={LABEL}>Name *</label>
              <input
                className="input"
                placeholder="e.g. NSIC Rc400"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>Category</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="inbred">Inbred</option>
                <option value="hybrid">Hybrid</option>
                <option value="local">Local</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Typical recovery %</label>
              <input
                className="input"
                type="number"
                placeholder="65"
                value={form.typical_recovery_pct}
                onChange={(e) => setForm((f) => ({ ...f, typical_recovery_pct: e.target.value }))}
              />
            </div>
          </div>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || "Failed to add variety."}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.code || !form.name}
            >
              {create.isPending ? "Saving…" : "Save variety"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              {["Code", "Name", "Category", "Recovery %", "Source", "Status", ""].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {active.map((v: any) => (
              <VarietyRow
                key={v.id}
                v={v}
                user={user}
                onToggle={() => toggle.mutate({ id: v.id, is_active: false })}
              />
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted font-medium">
                  No active varieties
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-soft bg-slate-50/40 dark:bg-slate-800/30">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-secondary hover:text-primary hover:bg-slate-100/50 dark:hover:bg-slate-600/15 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                Deactivated history ({inactive.length})
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
                  {inactive.map((v: any) => (
                    <VarietyRow
                      key={v.id}
                      v={v}
                      user={user}
                      onToggle={() => toggle.mutate({ id: v.id, is_active: true })}
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

function EquipmentRow({ e, onToggle }: { e: any; onToggle: () => void }) {
  return (
    <tr
      className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors ${
        !e.is_active ? "opacity-60" : ""
      }`}
    >
      <td className="px-4 py-3 font-semibold text-primary">{e.name}</td>
      <td className="px-4 py-3 text-secondary">{e.model || "—"}</td>
      <td className="px-4 py-3 text-secondary">
        {e.capacity_kg_per_hr ? `${e.capacity_kg_per_hr} kg/hr` : "—"}
      </td>
      <td className="px-4 py-3">
        {e.is_active ? (
          <span className="badge-green">Active</span>
        ) : (
          <span className="badge-red">Inactive</span>
        )}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onToggle}
          className={`text-xs font-semibold inline-flex items-center gap-1 ${
            e.is_active
              ? "text-rose-600 dark:text-rose-400 hover:text-rose-700"
              : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
          }`}
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
    queryFn: () => millingService.listEquipment(true),
  });
  const active = equipment.filter((e: any) => e.is_active);
  const inactive = equipment.filter((e: any) => !e.is_active);

  const create = useMutation({
    mutationFn: (b: typeof form) =>
      millingService.createEquipment({
        ...b,
        capacity_kg_per_hr: b.capacity_kg_per_hr ? parseFloat(b.capacity_kg_per_hr) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-all"] });
      qc.invalidateQueries({ queryKey: ["equipment"] });
      setShowForm(false);
      setForm({ name: "", model: "", capacity_kg_per_hr: "" });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      millingService.updateEquipment(id, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-all"] });
      qc.invalidateQueries({ queryKey: ["equipment"] });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">Add and manage milling equipment for your company.</p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add equipment
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">New equipment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={LABEL}>Name *</label>
              <input
                className="input"
                placeholder="e.g. Mill #1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>Model</label>
              <input
                className="input"
                placeholder="e.g. SB-30"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>Capacity (kg/hr)</label>
              <input
                className="input"
                type="number"
                placeholder="500"
                value={form.capacity_kg_per_hr}
                onChange={(e) => setForm((f) => ({ ...f, capacity_kg_per_hr: e.target.value }))}
              />
            </div>
          </div>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || "Failed to add equipment."}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.name}
            >
              {create.isPending ? "Saving…" : "Save equipment"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              {["Name", "Model", "Capacity", "Status", ""].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {active.map((e: any) => (
              <EquipmentRow
                key={e.id}
                e={e}
                onToggle={() => toggle.mutate({ id: e.id, is_active: false })}
              />
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted font-medium">
                  No active equipment
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-soft bg-slate-50/40 dark:bg-slate-800/30">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-secondary hover:text-primary hover:bg-slate-100/50 dark:hover:bg-slate-600/15 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                Deactivated history ({inactive.length})
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
                  {inactive.map((e: any) => (
                    <EquipmentRow
                      key={e.id}
                      e={e}
                      onToggle={() => toggle.mutate({ id: e.id, is_active: true })}
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

function CategoriesTab() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", is_production_cost: true });

  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => costsService.listCategories(),
  });

  const create = useMutation({
    mutationFn: (b: typeof form) => costsService.createCategory(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      setShowForm(false);
      setForm({ name: "", is_production_cost: true });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Categorize your expenses (Fuel, Electricity, Labor, etc.). System defaults are shared across
        all clients.
      </p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add category
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">New expense category</h3>
          <div>
            <label className={LABEL}>Category name *</label>
            <input
              className="input"
              placeholder="e.g. Sack/Packaging"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm font-medium text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-soft accent-emerald-500 cursor-pointer"
              checked={form.is_production_cost}
              onChange={(e) => setForm((f) => ({ ...f, is_production_cost: e.target.checked }))}
            />
            <span>Production cost (vs. overhead)</span>
          </label>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || "Failed to add category."}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.name}
            >
              {create.isPending ? "Saving…" : "Save category"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              {["Name", "Type", "Source"].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {categories.map((c: any) => {
              const isOwn = c.company_id === user?.company_id;
              return (
                <tr
                  key={c.id}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors"
                >
                  <td className="px-4 py-3 font-semibold text-primary">{c.name}</td>
                  <td className="px-4 py-3">
                    {c.is_production_cost ? (
                      <span className="badge-green">Production</span>
                    ) : (
                      <span className="badge-gray">Overhead</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isOwn ? (
                      <span className="badge-green">Custom</span>
                    ) : (
                      <span className="badge-gray">System</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {categories.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted font-medium">
                  No categories
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompanyTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["company"],
    queryFn: () => branchesService.getCompany(),
  });
  const [form, setForm] = useState<any>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: any) => branchesService.updateCompany(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading) {
    return <div className="card text-sm text-secondary">Loading…</div>;
  }

  const fields: { label: string; key: string; full?: boolean; type?: string }[] = [
    { label: "Company Name *", key: "name", full: true },
    { label: "Address", key: "address", full: true },
    { label: "TIN", key: "tin" },
    { label: "Phone", key: "phone" },
    { label: "Email", key: "email", type: "email" },
    { label: "NFA License No.", key: "nfa_license_no" },
    { label: "DA Registration No.", key: "da_registration_no" },
  ];

  return (
    <div className="card max-w-2xl space-y-5">
      <h3 className="text-lg font-bold text-primary">Company Information</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(({ label, key, full, type }) => (
          <div key={key} className={full ? "sm:col-span-2" : ""}>
            <label className={LABEL}>{label}</label>
            <input
              type={type || "text"}
              className="input"
              value={form[key] || ""}
              onChange={(e) => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2.5 text-sm font-medium text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-soft accent-emerald-500 cursor-pointer"
              checked={!!form.is_multi_branch}
              onChange={(e) => setForm((f: any) => ({ ...f, is_multi_branch: e.target.checked }))}
            />
            <span>Enable multi-branch mode</span>
          </label>
        </div>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => save.mutate(form)}
          className="btn-primary"
          disabled={save.isPending || !form.name}
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
        {saved && (
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
            <Check size={14} /> Saved
          </span>
        )}
        {save.isError && (
          <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
            Failed to save.
          </span>
        )}
      </div>
    </div>
  );
}

function BranchesTab() {
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchesService.list(),
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", is_main_branch: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ name: "", address: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showTrash, setShowTrash] = useState(false);

  const create = useMutation({
    mutationFn: (body: typeof form) => branchesService.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      setShowForm(false);
      setForm({ name: "", address: "", is_main_branch: false });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<typeof editValues> }) =>
      branchesService.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      setEditingId(null);
    },
  });

  // Warehouses the owner is allowed to bulk-delete (everything except main).
  const selectable = (branches as any[]).filter((b) => !b.is_main_branch);

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => branchesService.bulkDelete(ids),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      qc.invalidateQueries({ queryKey: ["branches-trash"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      setSelected(new Set());
      const skipped = res?.skipped ?? [];
      if (skipped.length) {
        alert(skipped.map((s: any) => s.reason).join("\n"));
      }
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === selectable.length ? new Set() : new Set(selectable.map((b: any) => b.id)),
    );
  }
  function confirmBulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (
      confirm(
        `Move ${ids.length} warehouse${ids.length === 1 ? "" : "s"} to trash? You can restore within 30 days.`,
      )
    ) {
      bulkDelete.mutate(ids);
    }
  }

  function startEdit(b: any) {
    setEditingId(b.id);
    setEditValues({ name: b.name, address: b.address || "" });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="text-sm text-secondary font-medium">
          {branches.length} branch{branches.length === 1 ? "" : "es"}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowTrash((v) => !v)} className="btn-secondary">
            <History size={16} /> {showTrash ? "Hide history" : "History / Trash"}
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            <Plus size={16} /> Add branch
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60">
          <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="btn-secondary !py-1.5 !px-3 text-sm"
            >
              Clear
            </button>
            <button
              onClick={confirmBulkDelete}
              disabled={bulkDelete.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
            >
              <Trash2 size={15} /> {bulkDelete.isPending ? "Deleting…" : "Delete selected"}
            </button>
          </div>
        </div>
      )}

      {showTrash && <BranchTrashPanel />}

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">New branch</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Name *</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>Address</label>
              <input
                className="input"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm font-medium text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-soft accent-emerald-500 cursor-pointer"
              checked={form.is_main_branch}
              onChange={(e) => setForm((f) => ({ ...f, is_main_branch: e.target.checked }))}
            />
            <span>Mark as main branch</span>
          </label>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || "Failed to create branch."}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.name}
            >
              {create.isPending ? "Creating…" : "Create branch"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              <th className={`${TABLE_HEAD} w-10`}>
                <input
                  type="checkbox"
                  aria-label="Select all warehouses"
                  className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer disabled:opacity-40"
                  disabled={selectable.length === 0}
                  checked={selectable.length > 0 && selected.size === selectable.length}
                  ref={(el) => {
                    if (el)
                      el.indeterminate = selected.size > 0 && selected.size < selectable.length;
                  }}
                  onChange={toggleAll}
                />
              </th>
              {["Name", "Address", "Type", "Status", ""].map((h, i) => (
                <th key={i} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {branches.map((b: any) => {
              const isEditing = editingId === b.id;
              return (
                <tr key={b.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-700/15">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${b.name}`}
                      className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer disabled:opacity-30"
                      disabled={b.is_main_branch}
                      title={b.is_main_branch ? "The main warehouse can't be deleted" : undefined}
                      checked={selected.has(b.id)}
                      onChange={() => toggle(b.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-primary">
                    {isEditing ? (
                      <input
                        autoFocus
                        className="input !py-1 text-sm w-full max-w-xs"
                        value={editValues.name}
                        onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingId(null);
                          if (e.key === "Enter" && editValues.name.trim()) {
                            update.mutate({
                              id: b.id,
                              body: { name: editValues.name.trim(), address: editValues.address },
                            });
                          }
                        }}
                      />
                    ) : (
                      b.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-secondary">
                    {isEditing ? (
                      <input
                        className="input !py-1 text-sm w-full max-w-xs"
                        placeholder="Address"
                        value={editValues.address}
                        onChange={(e) => setEditValues((v) => ({ ...v, address: e.target.value }))}
                      />
                    ) : (
                      b.address || "—"
                    )}
                  </td>
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
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label="Save"
                          disabled={!editValues.name.trim() || update.isPending}
                          onClick={() =>
                            update.mutate({
                              id: b.id,
                              body: { name: editValues.name.trim(), address: editValues.address },
                            })
                          }
                          className="p-1.5 rounded-md text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-40"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel"
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/40"
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Rename ${b.name}`}
                        onClick={() => startEdit(b)}
                        // Always visible (dimmed) — the opacity-toggle on hover
                        // caused flicker when the mouse crossed the icon edge.
                        className="p-1.5 rounded-md text-muted/70 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {branches.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted font-medium">
                  No branches
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BranchTrashPanel() {
  const qc = useQueryClient();
  const { data: trashed = [], isLoading } = useQuery<any[]>({
    queryKey: ["branches-trash"],
    queryFn: () => branchesService.listTrash(),
  });

  const restore = useMutation({
    mutationFn: (id: string) => branchesService.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      qc.invalidateQueries({ queryKey: ["branches-trash"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <History size={16} className="text-muted" />
        <h3 className="font-semibold text-primary">Recently deleted warehouses</h3>
      </div>
      <p className="text-xs text-muted">
        Deleted warehouses are kept for 30 days, then permanently removed.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted py-4 text-center">Loading…</p>
      ) : trashed.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">Trash is empty.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {trashed.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary truncate">{b.name}</p>
                <p className="text-xs text-muted">
                  {b.deleted_by_name ? `Deleted by ${b.deleted_by_name} · ` : ""}
                  <span
                    className={
                      b.days_remaining <= 3 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""
                    }
                  >
                    {b.days_remaining}d left
                  </span>
                </p>
              </div>
              <button
                onClick={() => restore.mutate(b.id)}
                disabled={restore.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-secondary text-sm font-semibold disabled:opacity-50"
              >
                <RotateCcw size={14} /> Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityTab() {
  const { data: rows = [], isLoading } = useQuery<ActivityRow[]>({
    queryKey: ["activity"],
    queryFn: () => activityService.list(),
  });
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-primary">Activity log</h3>
        <p className="text-sm text-secondary">
          Who deleted, restored, or purged warehouses — most recent first.
        </p>
      </div>
      <div className="card">
        <ActivityLogList rows={rows} loading={isLoading} />
      </div>
    </div>
  );
}

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState({
    full_name: user?.full_name || "",
    email: user?.email || "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (body: typeof form) => authService.updateProfile(body),
    onSuccess: async () => {
      setUser(await authService.me());
      setSaved(true);
      setError("");
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e: any) => setError(e.response?.data?.detail || "Failed to update."),
  });

  return (
    <div className="card max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-grad-brand grid place-items-center text-white text-base font-bold shadow-grad-glow">
          {(user?.full_name || user?.username || "?")
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <div>
          <h3 className="text-lg font-bold text-primary">My profile</h3>
          <p className="text-xs text-muted font-medium capitalize">{user?.role}</p>
        </div>
      </div>

      <div>
        <label className={LABEL}>Username</label>
        <input
          className="input opacity-70 cursor-not-allowed"
          value={user?.username || ""}
          disabled
        />
      </div>
      <div>
        <label className={LABEL}>Full name</label>
        <input
          className="input"
          value={form.full_name}
          onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
        />
      </div>
      <div>
        <label className={LABEL}>Email</label>
        <input
          type="email"
          className="input"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button onClick={() => save.mutate(form)} className="btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save profile"}
        </button>
        {saved && (
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
            <Check size={14} /> Saved
          </span>
        )}
        {error && (
          <span className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</span>
        )}
      </div>
    </div>
  );
}

function PasswordTab() {
  const [form, setForm] = useState({
    current_password: "",
    new_password: "",
    confirm: "",
  });
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const change = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      authService.changePassword(body.current_password, body.new_password),
    onSuccess: () => {
      setMsg({ type: "ok", text: "Password changed successfully." });
      setForm({ current_password: "", new_password: "", confirm: "" });
    },
    onError: (e: any) =>
      setMsg({
        type: "err",
        text: e.response?.data?.detail || "Failed to change password.",
      }),
  });

  const submit = () => {
    setMsg(null);
    if (form.new_password !== form.confirm)
      return setMsg({ type: "err", text: "New passwords do not match." });
    if (form.new_password.length < 8)
      return setMsg({
        type: "err",
        text: "New password must be at least 8 characters.",
      });
    change.mutate({
      current_password: form.current_password,
      new_password: form.new_password,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <div className="card space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
            <KeyRound size={18} className="text-white" />
          </div>
          <h3 className="text-lg font-bold text-primary">Change password</h3>
        </div>

        {[
          { label: "Current password", key: "current_password" },
          { label: "New password", key: "new_password" },
          { label: "Confirm new password", key: "confirm" },
        ].map(({ label, key }) => (
          <div key={key}>
            <label className={LABEL}>{label}</label>
            <input
              type="password"
              className="input"
              value={(form as any)[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder="••••••••"
            />
          </div>
        ))}

        {msg && (
          <p
            className={`text-sm font-semibold inline-flex items-center gap-1.5 ${
              msg.type === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {msg.type === "ok" ? <Check size={14} /> : <AlertCircle size={14} />}
            {msg.text}
          </p>
        )}

        <button
          onClick={submit}
          className="btn-primary w-full"
          disabled={change.isPending || !form.current_password || !form.new_password}
        >
          {change.isPending ? "Changing…" : "Change password"}
        </button>
      </div>

      <MfaCard />
    </div>
  );
}

/** Two-factor authentication management (security hardening P1.9).
 *  Enroll: fetch secret → user adds it to an authenticator app → verify a code.
 *  Strongly recommended (and surfaced via mfa_setup_recommended) for owners
 *  and platform admins. */
function MfaCard() {
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ["auth-me-mfa"], queryFn: () => authService.me() });
  const [enroll, setEnroll] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const mfaEnabled = !!meQ.data?.mfa_enabled;
  const recommended = !!meQ.data?.mfa_setup_recommended;
  const codesRemaining = meQ.data?.mfa_backup_codes_remaining ?? 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["auth-me-mfa"] });
    qc.invalidateQueries({ queryKey: ["auth-me"] });
  };

  const start = async () => {
    setMsg(null);
    try {
      setEnroll(await authService.mfaEnroll());
    } catch (e: any) {
      setMsg({ type: "err", text: e.response?.data?.detail || "Could not start enrollment." });
    }
  };

  const confirmEnroll = async () => {
    setMsg(null);
    try {
      const res = await authService.mfaEnrollVerify(code.trim());
      setEnroll(null);
      setCode("");
      setBackupCodes(res.backup_codes); // show once
      refresh();
    } catch (e: any) {
      setMsg({ type: "err", text: e.response?.data?.detail || "Invalid code." });
    }
  };

  const confirmRegenerate = async () => {
    setMsg(null);
    try {
      const res = await authService.regenerateBackupCodes(code.trim());
      setRegenerating(false);
      setCode("");
      setBackupCodes(res.backup_codes);
      refresh();
    } catch (e: any) {
      setMsg({ type: "err", text: e.response?.data?.detail || "Invalid code." });
    }
  };

  const confirmDisable = async () => {
    setMsg(null);
    try {
      await authService.mfaDisable(code.trim());
      setDisabling(false);
      setCode("");
      setMsg({ type: "ok", text: "Two-factor authentication disabled." });
      refresh();
    } catch (e: any) {
      setMsg({ type: "err", text: e.response?.data?.detail || "Invalid code." });
    }
  };

  const codeInput = (
    <input
      className="input text-center tracking-[0.4em]"
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="••••••"
    />
  );

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <ShieldCheck size={18} className="text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-primary">Two-factor authentication</h3>
          <p className="text-sm text-secondary">
            {mfaEnabled
              ? "Enabled — codes required at sign-in."
              : "Add a 6-digit authenticator code to sign-in."}
          </p>
        </div>
      </div>

      {recommended && !enroll && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/15 ring-1 ring-inset ring-amber-500/40 text-sm font-medium text-amber-700 dark:text-amber-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            As an owner/admin account, enabling two-factor authentication is strongly recommended.
          </span>
        </div>
      )}

      {backupCodes && (
        <div className="space-y-4">
          <BackupCodes codes={backupCodes} />
          <button onClick={() => setBackupCodes(null)} className="btn-primary w-full">
            I&apos;ve saved my codes
          </button>
        </div>
      )}

      {!mfaEnabled && !enroll && !backupCodes && (
        <button onClick={start} className="btn-primary w-full">
          Enable two-factor authentication
        </button>
      )}

      {enroll && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Add this key to your authenticator app (Google Authenticator, Authy, 1Password…), then
            enter the 6-digit code it shows to confirm.
          </p>
          <div className="px-3 py-2.5 rounded-xl bg-slate-500/10 ring-1 ring-inset ring-slate-500/30 font-mono text-sm break-all select-all">
            {enroll.secret}
          </div>
          {codeInput}
          <div className="flex gap-2">
            <button
              onClick={confirmEnroll}
              className="btn-primary flex-1"
              disabled={code.length < 6}
            >
              Confirm &amp; enable
            </button>
            <button
              onClick={() => {
                setEnroll(null);
                setCode("");
                setMsg(null);
              }}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mfaEnabled && !disabling && !regenerating && !backupCodes && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-secondary">
              Recovery codes:{" "}
              <span className="font-semibold text-primary">{codesRemaining} left</span>
              {codesRemaining <= 3 && (
                <span className="text-amber-600 dark:text-amber-400"> · running low</span>
              )}
            </span>
            <button
              onClick={() => {
                setRegenerating(true);
                setMsg(null);
              }}
              className="font-semibold text-grad-brand hover:opacity-80"
            >
              Regenerate
            </button>
          </div>
          <button
            onClick={() => {
              setDisabling(true);
              setMsg(null);
            }}
            className="btn-secondary w-full"
          >
            Disable two-factor authentication
          </button>
        </div>
      )}

      {regenerating && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Enter a current authenticator code to issue new recovery codes. This invalidates your
            old codes.
          </p>
          {codeInput}
          <div className="flex gap-2">
            <button
              onClick={confirmRegenerate}
              className="btn-primary flex-1"
              disabled={code.length < 6}
            >
              Regenerate codes
            </button>
            <button
              onClick={() => {
                setRegenerating(false);
                setCode("");
                setMsg(null);
              }}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {disabling && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Enter a current authenticator code to confirm disabling.
          </p>
          {codeInput}
          <div className="flex gap-2">
            <button
              onClick={confirmDisable}
              className="btn-primary flex-1"
              disabled={code.length < 6}
            >
              Disable
            </button>
            <button
              onClick={() => {
                setDisabling(false);
                setCode("");
                setMsg(null);
              }}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p
          className={`text-sm font-semibold inline-flex items-center gap-1.5 ${
            msg.type === "ok"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {msg.type === "ok" ? <Check size={14} /> : <AlertCircle size={14} />}
          {msg.text}
        </p>
      )}
    </div>
  );
}

/** Active sessions / devices (security hardening — phase 5). Lists the user's
 *  live login sessions and lets them revoke any one or sign out all others. */
function SessionsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auth-sessions"], queryFn: () => authService.sessions() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["auth-sessions"] });

  const revokeOne = useMutation({
    mutationFn: (id: string) => authService.revokeSession(id),
    onSuccess: refresh,
  });
  const revokeOthers = useMutation({
    mutationFn: () => authService.revokeOtherSessions(),
    onSuccess: refresh,
  });

  const sessions = q.data ?? [];
  const hasOthers = sessions.some((s) => !s.current);
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="card max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <MonitorSmartphone size={18} className="text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-primary">Devices &amp; sessions</h3>
          <p className="text-sm text-secondary">
            Where you&apos;re signed in. Revoke anything you don&apos;t recognize.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-secondary">
          <Loader2 size={15} className="animate-spin" /> Loading sessions…
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl ring-1 ring-inset ring-slate-500/20 bg-slate-500/5"
            >
              <div className="min-w-0">
                <p className="font-semibold text-primary flex items-center gap-2">
                  {s.client}
                  {s.current && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted">Last active {fmt(s.last_active)}</p>
              </div>
              {!s.current && (
                <button
                  onClick={() => revokeOne.mutate(s.id)}
                  disabled={revokeOne.isPending}
                  className="shrink-0 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:opacity-80"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {hasOthers && (
        <button
          onClick={() => revokeOthers.mutate()}
          disabled={revokeOthers.isPending}
          className="btn-secondary w-full inline-flex items-center justify-center gap-1.5"
        >
          <LogOut size={15} />{" "}
          {revokeOthers.isPending ? "Signing out…" : "Sign out all other devices"}
        </button>
      )}
    </div>
  );
}
