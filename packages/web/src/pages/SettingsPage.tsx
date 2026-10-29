import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { googleSignInEnabled } from "../utils/googleSignIn";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { billingService } from "../services/BillingService";
import { branchesService } from "../services/BranchesService";
import { activityService } from "../services/ActivityService";
import { authService } from "../services/AuthService";

import { useAuthStore } from "../stores/authStore";
import { useThemeStore, type Theme } from "../stores/themeStore";
import UserAvatar from "../components/UserAvatar";
import PasswordInput from "../components/PasswordInput";
import {
  Building2,
  MapPin,
  User as UserIcon,
  KeyRound,
  Plus,
  History,
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
  Palette,
  Sun,
  Moon,
  Download,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { useCurrentPlan } from "../hooks/useFeature";
import { useAccess } from "../hooks/useAccess";
import { roleLabel, type SubscriptionPlan, type UpgradeRequest } from "@rice-mill/shared";
import ActivityLogList from "../components/activity/ActivityLogList";
import BackupCodes from "../components/BackupCodes";
import TotpSetup from "../components/TotpSetup";
import DataExport from "../components/DataExport";
import ConfirmDialog from "../components/ConfirmDialog";
import DeviceSessionCard from "../components/DeviceSessionCard";
import AccountClosureCard from "../components/AccountClosureCard";
import LanguagePicker from "../components/LanguagePicker";
import type { ActivityRow } from "../components/activity/format";
import { Trash2, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import { tx } from "../i18n/tx";
import { statusText } from "../utils/statusText";

type Tab =
  | "billing"
  | "company"
  | "branches"
  | "activity"
  | "data"
  | "profile"
  | "appearance"
  | "password"
  | "sessions";

const LABEL = "block text-sm font-semibold text-secondary mb-1.5";
const TABLE_HEAD =
  "px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

export default function SettingsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const { canView } = useAccess();
  // The mill's settings are for whoever the Boss opened Settings to (by default
  // the Boss and the Admin). Everyone else manages only their own account.
  const millSettings = canView("settings");
  const [tab, setTab] = useState<Tab>(millSettings ? "billing" : "profile");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    // The mill's settings. Varieties, machines and expense categories are on
    // Stock > Catalog.
    ...(millSettings
      ? [
          { key: "billing" as Tab, label: t("Billing"), icon: CreditCard },
          { key: "company" as Tab, label: t("Company"), icon: Building2 },
          { key: "branches" as Tab, label: t("Branches"), icon: MapPin },
          { key: "activity" as Tab, label: t("Activity Log"), icon: History },
        ]
      : []),
    // The full data export holds every record, government IDs included: owner only.
    ...(role === "owner" ? [{ key: "data" as Tab, label: t("Your Data"), icon: Download }] : []),
    // Personal settings — available to every role.
    { key: "profile", label: t("My Profile"), icon: UserIcon },
    { key: "appearance", label: t("Appearance"), icon: Palette },
    { key: "password", label: t("Password"), icon: KeyRound },
    { key: "sessions", label: t("Devices"), icon: MonitorSmartphone },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <SettingsIcon size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">{t("Settings")}</h2>
          <p className="text-sm text-secondary">
            {t("Manage your account and platform preferences")}
          </p>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-6">
        <aside className="w-full xl:w-64 shrink-0 min-w-0">
          <nav className="tab-strip flex xl:flex-col gap-1 overflow-x-auto pb-4 xl:pb-0 -mx-1 xl:mx-0 px-1">
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
          {tab === "activity" && <ActivityTab />}
          {tab === "data" && <DataExport />}
          {tab === "profile" && <ProfileTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "password" && <PasswordTab />}
          {tab === "sessions" && <SessionsTab />}
        </main>
      </div>
    </div>
  );
}

// In the order a plan card lists them: the basics, then what each tier adds.
const FEATURE_LABELS: Record<string, string> = {
  dashboard: t("Dashboard"),
  paddy: t("Paddy procurement"),
  inventory: t("Inventory tracking"),
  sales: t("Sales & invoices"),
  expenses: t("Expense tracking"),
  users: t("User management"),
  milling: t("Milling operations"),
  dispatch: t("Dispatch (deliveries, trucks and drivers)"),
  multi_branch: t("More than one branch"),
  field_operators: t("Field operators (agents and millers)"),
  cash_count: t("Cash count"),
  collections: t("Collections"),
  employees: t("Employees module"),
  reports_advanced: t("Advanced reports (AR aging, valuation)"),
  compliance_reports: t("DA / NFA compliance reports"),
  offline_sync: t("Offline sync (Electron desktop)"),
  canva_inventory: t("Visual Warehouse canva (spatial inventory)"),
  drying_advisor: t("Palay drying advisor"),
  automations: t("Automations (morning summary, reminders)"),
};

const ALL_FEATURE_KEYS = Object.keys(FEATURE_LABELS);
/** Labelled features in FEATURE_LABELS order; any unknown code after them. */
const byFeatureOrder = (a: string, b: string) => {
  const rank = (f: string) => {
    const i = ALL_FEATURE_KEYS.indexOf(f);
    return i === -1 ? ALL_FEATURE_KEYS.length : i;
  };
  return rank(a) - rank(b);
};

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
          ? t("Your upgrade to {{requested_plan_name}} has been approved.", {
              requested_plan_name: request.requested_plan_name,
            })
          : t("Your upgrade to {{requested_plan_name}} was not approved.", {
              requested_plan_name: request.requested_plan_name,
            })}
        {request.admin_note && (
          <span className="ml-1 font-normal opacity-80">— {request.admin_note}</span>
        )}
      </p>
    </div>
  );
}

function BillingTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const plan = useCurrentPlan();
  const user = useAuthStore((s) => s.user);
  const features = (user?.features as string[] | undefined) || [];
  const canRequest = useAccess().canEdit("settings");
  const isOnPaidPlan =
    !!plan && plan.monthly_price > 0 && (plan.status === "active" || plan.status === "trial");
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => getSeenRequests());
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");

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
    // The decision is also emailed; this only keeps an open page current.
    refetchInterval: 60 * 1000,
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

  // Picking a plan opens checkout, which sends the request once it's paid for.
  const goToCheckout = (plan_id: string) =>
    navigate(
      `/settings/checkout?${new URLSearchParams({ plan: plan_id, interval: billingInterval })}`,
    );

  const cancelRequest = useMutation({
    mutationFn: (id: string) => billingService.cancelUpgradeRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-my-request"] });
    },
  });

  if (!plan) {
    return (
      <div className="card text-sm text-secondary">
        {t("No subscription on file. Contact your platform administrator.")}
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
            <p className="text-xs font-bold tracking-wide uppercase text-white/75">
              {t("Current plan")}
            </p>
            <div className="flex items-baseline gap-3 mt-1.5 flex-wrap">
              <h3 className="text-3xl font-extrabold tracking-tight">{plan.name}</h3>
              <span className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
                {plan.code}
              </span>
            </div>
            <p className="text-white/85 mt-2 font-medium">
              {plan.monthly_price > 0
                ? `₱${plan.monthly_price.toLocaleString()}/month`
                : t("Free forever")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-white/75">{t("Status")}</p>
            <p className="text-sm font-bold capitalize mt-1 flex items-center justify-end gap-1.5">
              <span className={`w-2 h-2 rounded-full ${statusDot}`} />
              {statusText(plan.status)}
            </p>
          </div>
        </div>

        {/* Expiry strip */}
        {(() => {
          if (!plan.expires_at) {
            return (
              <div className="relative mt-5 flex items-center gap-2 rounded-xl bg-white/10 ring-1 ring-white/20 px-4 py-2.5 text-sm text-white/90">
                <Clock size={14} className="shrink-0" />
                <span className="font-medium">{t("Permanent subscription — no expiry")}</span>
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
                  {expired
                    ? t("Subscription expired")
                    : tx("Expires on {{date}}", {
                        date: <span className="font-bold">{format(expDate, "MMMM d, yyyy")}</span>,
                      })}
                </span>
              </div>
              {!expired && (
                <span
                  className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
                    urgent ? "bg-white/25 text-white" : "bg-white/15 text-white/90"
                  }`}
                >
                  {t("{{count}} days left", { count: daysLeft })}
                </span>
              )}
            </div>
          );
        })()}

        <div className="relative grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-white/20 text-sm">
          <div>
            <p className="text-white/75 font-medium">{t("User limit")}</p>
            <p className="font-bold text-lg mt-0.5">{plan.max_users ?? t("Unlimited")}</p>
          </div>
          <div>
            <p className="text-white/75 font-medium">{t("Branch limit")}</p>
            <p className="font-bold text-lg mt-0.5">{plan.max_branches ?? t("Unlimited")}</p>
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
                    {isPlanChange ? t("Plan Change Requested") : t("Upgrade Requested")}
                  </span>
                </div>
                {canRequest && (
                  <button
                    onClick={() => cancelRequest.mutate(pendingRequest.id)}
                    disabled={cancelRequest.isPending}
                    className="text-white/80 hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {cancelRequest.isPending ? t("Cancelling…") : t("Cancel")}
                  </button>
                )}
              </div>
              <div className="bg-white dark:bg-slate-900 px-4 py-3.5">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {(() => {
                    const plan = (
                      <span className="text-indigo-600 dark:text-indigo-400">
                        {pendingRequest.requested_plan_name}
                      </span>
                    );
                    return isPlanChange
                      ? tx("Change to {{plan}}", { plan })
                      : tx("Upgrade to {{plan}}", { plan });
                  })()}
                  {pendingRequest.billing_interval === "annual" && (
                    <span className="badge-green ml-2 !text-[10px] align-middle">
                      {t("Annual")}
                    </span>
                  )}
                  {pendingRequest.created_at && (
                    <span className="font-normal text-slate-400 text-sm">
                      {" "}
                      · {format(new Date(pendingRequest.created_at), "MMM d, yyyy")}
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {isPlanChange
                    ? t(
                        "Awaiting admin approval. If approved, the new plan will take effect at the end of your current billing period.",
                      )
                    : t("Awaiting platform administrator approval.")}
                </p>
              </div>
            </div>
          );
        })()}

      {!pendingRequest && recentResolved && (
        <ResolvedNotice request={recentResolved} onDone={dismissResolved} />
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-lg font-bold text-primary">{t("Available plans")}</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {!canRequest && (
              <span className="text-xs font-medium text-muted">
                {t("Only owners/admins can request upgrades")}
              </span>
            )}
            <div className="seg" role="group" aria-label={t("Billing interval")}>
              <button
                type="button"
                onClick={() => setBillingInterval("monthly")}
                aria-pressed={billingInterval === "monthly"}
                className={`seg-btn ${billingInterval === "monthly" ? "is-active" : ""}`}
              >
                {t("Monthly")}
              </button>
              <button
                type="button"
                onClick={() => setBillingInterval("annual")}
                aria-pressed={billingInterval === "annual"}
                className={`seg-btn ${billingInterval === "annual" ? "is-active" : ""}`}
              >
                {t("Annual")}
              </button>
            </div>
          </div>
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
            const isAnnual = billingInterval === "annual";
            // A plan with no annual price set is billed as 12 months.
            const hasAnnualPrice = p.annual_price > 0;
            const annualPrice = hasAnnualPrice ? p.annual_price : p.monthly_price * 12;
            const displayPrice = isAnnual ? annualPrice : p.monthly_price;
            const annualSavingsPct =
              isAnnual && hasAnnualPrice && p.monthly_price > 0
                ? Math.round((1 - p.annual_price / (p.monthly_price * 12)) * 100)
                : 0;
            return (
              <div
                key={p.id}
                className={`rounded-2xl border-2 p-5 flex flex-col transition-all ${ring} ${bg}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={accent}>{planIcon(p.code, 18)}</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{p.name}</span>
                  {isCurrent && <span className="ml-auto badge-green">{t("Current")}</span>}
                </div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {displayPrice === 0 ? t("Free") : `₱${displayPrice.toLocaleString()}`}
                  </span>
                  {displayPrice > 0 && (
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                      {isAnnual ? "/yr" : "/mo"}
                    </span>
                  )}
                </div>
                {annualSavingsPct > 0 && (
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 -mt-0.5">
                    {t("Save {{annualSavingsPct}}% vs monthly", { annualSavingsPct })}
                  </p>
                )}
                <p className="text-sm text-slate-800 dark:text-slate-200 mt-1 mb-2">
                  {p.description}
                </p>
                <div className="text-xs text-slate-700 dark:text-slate-300 font-semibold mb-3">
                  {p.max_users
                    ? t("{{count}} users", { count: p.max_users })
                    : t("Unlimited users")}{" "}
                  ·{" "}
                  {p.max_branches
                    ? t("{{count}} branches", { count: p.max_branches })
                    : t("Unlimited branches")}
                </div>
                <ul className="text-sm text-slate-800 dark:text-slate-200 space-y-1.5 flex-1">
                  {[...(p.features || [])].sort(byFeatureOrder).map((f) => (
                    <li key={f} className="flex items-center gap-1.5">
                      <Check size={14} className={`${checkColor} shrink-0`} />
                      {FEATURE_LABELS[f] || f.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <button disabled className="btn-secondary w-full opacity-70 cursor-default">
                      {t("Your current plan")}
                    </button>
                  ) : p.code === "free" ? (
                    <button
                      disabled
                      className="btn-secondary w-full opacity-70 cursor-default"
                      title={t(
                        "Free is assigned automatically when your subscription ends — you can't request it.",
                      )}
                    >
                      {t("Default plan")}
                    </button>
                  ) : isPendingTarget ? (
                    <button disabled className="btn-secondary w-full opacity-70 cursor-default">
                      {t("Pending approval")}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => goToCheckout(p.id)}
                        disabled={!canRequest || !!pendingRequest}
                        className="btn-primary w-full"
                        title={
                          !canRequest
                            ? t("Owner/admin role required")
                            : pendingRequest
                              ? t("Cancel your pending request first")
                              : undefined
                        }
                      >
                        {isOnPaidPlan ? t("Change Plan") : t("Get {{name}}", { name: p.name })}
                      </button>
                      {isOnPaidPlan && (
                        <p className="text-[11px] text-center text-slate-600 dark:text-slate-400 mt-1.5">
                          {t("Takes effect at end of current billing period")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-bold text-primary mb-4">
          {t("What's included in {{name}}", { name: plan.name })}
        </h3>
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

function CompanyTab() {
  const qc = useQueryClient();
  const readOnly = !useAccess().canEdit("settings");
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
    return <div className="card text-sm text-secondary">{t("Loading…")}</div>;
  }

  const fields: { label: string; key: string; full?: boolean; type?: string }[] = [
    { label: t("Company Name *"), key: "name", full: true },
    { label: t("Address"), key: "address", full: true },
    { label: t("TIN"), key: "tin" },
    { label: t("Phone"), key: "phone" },
    { label: t("Email"), key: "email", type: "email" },
    { label: t("NFA License No."), key: "nfa_license_no" },
    { label: t("DA Registration No."), key: "da_registration_no" },
  ];

  return (
    <div className="card max-w-2xl space-y-5">
      <h3 className="text-lg font-bold text-primary">{t("Company Information")}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(({ label, key, full, type }) => (
          <div key={key} className={full ? "sm:col-span-2" : ""}>
            <label className={LABEL}>{label}</label>
            <input
              type={type || "text"}
              className="input disabled:opacity-70"
              disabled={readOnly}
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
              disabled={readOnly}
              onChange={(e) => setForm((f: any) => ({ ...f, is_multi_branch: e.target.checked }))}
            />
            <span>{t("Enable multi-branch mode")}</span>
          </label>
        </div>
      </div>
      {readOnly ? (
        <p className="text-sm text-secondary">{t("View only: your role can't change these.")}</p>
      ) : (
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => save.mutate(form)}
            className="btn-primary"
            disabled={save.isPending || !form.name}
          >
            {save.isPending ? t("Saving…") : t("Save changes")}
          </button>
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <Check size={14} /> {t("Saved")}
            </span>
          )}
          {save.isError && (
            <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {t("Failed to save.")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function BranchesTab() {
  const qc = useQueryClient();
  const readOnly = !useAccess().canEdit("settings");
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
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  // Why some of the selected branches were left out of the last bulk delete.
  const [skippedReasons, setSkippedReasons] = useState<string[]>([]);

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

  // Branches the owner is allowed to bulk-delete (everything except main).
  const selectable = (branches as any[]).filter((b) => !b.is_main_branch);

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => branchesService.bulkDelete(ids),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      qc.invalidateQueries({ queryKey: ["branches-trash"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      setSelected(new Set());
      const skipped = res?.skipped ?? [];
      setSkippedReasons(skipped.map((s: any) => String(s.reason)));
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
    if (selected.size) setConfirmingBulk(true);
  }

  function startEdit(b: any) {
    setEditingId(b.id);
    setEditValues({ name: b.name, address: b.address || "" });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="text-sm text-secondary font-medium">
          {t("{{count}} branches", { count: branches.length })}
        </p>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowTrash((v) => !v)} className="btn-secondary">
              <History size={16} /> {showTrash ? t("Hide history") : t("History / Trash")}
            </button>
            <button onClick={() => setShowForm(!showForm)} className="btn-primary">
              <Plus size={16} /> {t("Add branch")}
            </button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60">
          <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">
            {t("{{selectedCount}} selected", { selectedCount: selected.size })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="btn-secondary !py-1.5 !px-3 text-sm"
            >
              {t("Clear")}
            </button>
            <button
              onClick={confirmBulkDelete}
              disabled={bulkDelete.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
            >
              <Trash2 size={15} /> {bulkDelete.isPending ? t("Deleting…") : t("Delete selected")}
            </button>
          </div>
        </div>
      )}

      {skippedReasons.length > 0 && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-800/60"
        >
          <ul className="space-y-0.5 text-sm font-medium text-amber-800 dark:text-amber-200">
            {skippedReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <button
            type="button"
            aria-label={t("Dismiss")}
            onClick={() => setSkippedReasons([])}
            className="btn-ghost !p-1.5 shrink-0"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingBulk}
        danger
        busy={bulkDelete.isPending}
        title={t("Move {{count}} branches to trash?", { count: selected.size })}
        confirmLabel={t("Move to trash")}
        onCancel={() => setConfirmingBulk(false)}
        onConfirm={() => {
          bulkDelete.mutate([...selected]);
          setConfirmingBulk(false);
        }}
      >
        {t("You can restore them within 30 days.", { count: selected.size })}
      </ConfirmDialog>

      {showTrash && <BranchTrashPanel />}

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">{t("New branch")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{t("Name *")}</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>{t("Address")}</label>
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
            <span>{t("Mark as main branch")}</span>
          </label>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || t("Failed to create branch.")}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.name}
            >
              {create.isPending ? t("Creating…") : t("Create branch")}
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
                  aria-label={t("Select all branches")}
                  className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer disabled:opacity-40"
                  disabled={readOnly || selectable.length === 0}
                  checked={selectable.length > 0 && selected.size === selectable.length}
                  ref={(el) => {
                    if (el)
                      el.indeterminate = selected.size > 0 && selected.size < selectable.length;
                  }}
                  onChange={toggleAll}
                />
              </th>
              {[t("Name"), t("Address"), t("Type"), t("Status"), ""].map((h, i) => (
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
                      aria-label={t("Select {{name}}", { name: b.name })}
                      className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer disabled:opacity-30"
                      disabled={readOnly || b.is_main_branch}
                      title={
                        b.is_main_branch ? t("The main branch can't be deleted") : undefined
                      }
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
                        placeholder={t("Address")}
                        value={editValues.address}
                        onChange={(e) => setEditValues((v) => ({ ...v, address: e.target.value }))}
                      />
                    ) : (
                      b.address || "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {b.is_main_branch ? (
                      <span className="badge-green">{t("Main")}</span>
                    ) : (
                      <span className="badge-gray">{t("Branch")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {b.is_active ? (
                      <span className="badge-green">{t("Active")}</span>
                    ) : (
                      <span className="badge-red">{t("Inactive")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={t("Save")}
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
                          aria-label={t("Cancel")}
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/40"
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                    ) : readOnly ? null : (
                      <button
                        type="button"
                        aria-label={t("Rename {{name}}", { name: b.name })}
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
                  {t("No branches")}
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
        <h3 className="font-semibold text-primary">{t("Recently deleted branches")}</h3>
      </div>
      <p className="text-xs text-muted">
        {t("Deleted branches are kept for 30 days, then permanently removed.")}
      </p>
      {isLoading ? (
        <p className="text-sm text-muted py-4 text-center">{t("Loading…")}</p>
      ) : trashed.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">{t("Trash is empty.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {trashed.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary truncate">{b.name}</p>
                <p className="text-xs text-muted">
                  {b.deleted_by_name
                    ? t("Deleted by {{deleted_by_name}} · ", { deleted_by_name: b.deleted_by_name })
                    : ""}
                  <span
                    className={
                      b.days_remaining <= 3 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""
                    }
                  >
                    {t("{{days_remaining}}d left", { days_remaining: b.days_remaining })}
                  </span>
                </p>
              </div>
              <button
                onClick={() => restore.mutate(b.id)}
                disabled={restore.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-secondary text-sm font-semibold disabled:opacity-50"
              >
                <RotateCcw size={14} /> {t("Restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The most days one look at the log covers (the server refuses more), and the
// most rows it sends back.
const ACTIVITY_MAX_DAYS = 31;
const ACTIVITY_ROW_LIMIT = 500;

const isoDay = (d: Date) => format(d, "yyyy-MM-dd");
const spanDays = (start: string, end: string) =>
  differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;

function ActivityTab() {
  const today = isoDay(new Date());
  // The last month: today and the 30 days before it.
  const lastMonth = () => ({
    start: isoDay(subDays(new Date(), ACTIVITY_MAX_DAYS - 1)),
    end: isoDay(new Date()),
  });
  const [range, setRange] = useState(lastMonth);

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery<ActivityRow[]>({
    queryKey: ["activity", range.start, range.end],
    queryFn: () => activityService.list(range),
  });

  // Moving one end past the 31 days drags the other along, so the range is
  // always one the server accepts.
  const setStart = (start: string) => {
    if (!start) return;
    setRange((r) => {
      let end = r.end < start ? start : r.end;
      if (spanDays(start, end) > ACTIVITY_MAX_DAYS) {
        end = isoDay(addDays(parseISO(start), ACTIVITY_MAX_DAYS - 1));
      }
      return { start, end: end > today ? today : end };
    });
  };
  const setEnd = (end: string) => {
    if (!end) return;
    setRange((r) => {
      let start = r.start > end ? end : r.start;
      if (spanDays(start, end) > ACTIVITY_MAX_DAYS) {
        start = isoDay(subDays(parseISO(end), ACTIVITY_MAX_DAYS - 1));
      }
      return { start, end };
    });
  };

  const isLastMonth = range.start === lastMonth().start && range.end === today;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-primary">{t("Activity log")}</h3>
        <p className="text-sm text-secondary">
          {t(
            "Who deleted, restored, or purged branches, and who downloaded the mill's data, most recent first. It shows the last month; pick other days to look further back, up to",
          )}{" "}
          {ACTIVITY_MAX_DAYS} {t("days at a time.")}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="activity-from" className={LABEL}>
            {t("From")}
          </label>
          <input
            id="activity-from"
            type="date"
            className="input"
            value={range.start}
            max={today}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="activity-to" className={LABEL}>
            {t("To")}
          </label>
          <input
            id="activity-to"
            type="date"
            className="input"
            value={range.end}
            min={range.start}
            max={today}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        {!isLastMonth && (
          <button type="button" onClick={() => setRange(lastMonth())} className="btn-secondary">
            {t("Last month")}
          </button>
        )}
      </div>
      {error ? (
        <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
          {(error as any)?.response?.data?.detail || t("Couldn't load the activity.")}
        </p>
      ) : (
        rows.length >= ACTIVITY_ROW_LIMIT && (
          <p className="text-sm text-secondary">
            {t("Showing the latest {{limit}}. Pick fewer days to see the rest.", {
              limit: ACTIVITY_ROW_LIMIT,
            })}
          </p>
        )
      )}
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
    current_password: "",
    mfa_code: "",
  });
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const emailChanged = form.email.trim().toLowerCase() !== (user?.email ?? "").trim().toLowerCase();
  const hasEmailProof = !!form.current_password || (!!user?.mfa_enabled && !!form.mfa_code);

  const save = useMutation({
    mutationFn: () =>
      authService.updateProfile({
        full_name: form.full_name.trim(),
        ...(emailChanged
          ? {
              email: form.email.trim(),
              ...(form.current_password ? { current_password: form.current_password } : {}),
              ...(form.mfa_code ? { mfa_code: form.mfa_code.trim() } : {}),
            }
          : {}),
      }),
    onSuccess: async () => {
      const updated = await authService.me();
      setUser(updated);
      setForm((current) => ({
        ...current,
        email: updated.email ?? current.email,
        current_password: "",
        mfa_code: "",
      }));
      setSaved(emailChanged ? t("Verification sent to your new email.") : t("Saved"));
      setError("");
      setTimeout(() => setSaved(""), 3500);
    },
    onError: (e: any) => setError(e.response?.data?.detail || t("Failed to update.")),
  });

  return (
    <div className="max-w-xl space-y-6">
      <div className="card space-y-5">
        <div className="flex items-center gap-3">
          <UserAvatar className="h-12 w-12" name={user?.full_name || user?.username} />
          <div>
            <h3 className="text-lg font-bold text-primary">{t("My profile")}</h3>
            <p className="text-xs text-muted font-medium">
              {user?.role_label || t(roleLabel(user?.role))}
            </p>
          </div>
        </div>

        <div>
          <label className={LABEL}>{t("Username")}</label>
          <input
            className="input opacity-70 cursor-not-allowed"
            value={user?.username || ""}
            disabled
          />
        </div>
        <div>
          <label className={LABEL}>{t("Full name")}</label>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          />
        </div>
        <div>
          <label className={LABEL}>{t("Email")}</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
        </div>
        {emailChanged && (
          <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/20 ring-1 ring-amber-200 dark:ring-amber-800/50 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-primary">
                {t("Confirm this sensitive change")}
              </p>
              <p className="text-xs text-secondary mt-0.5">
                {t(
                  "Changing your email signs it out of verified status until you confirm the new address.",
                )}
              </p>
            </div>
            <div>
              <label className={LABEL}>{t("Current password")}</label>
              <PasswordInput
                className="input"
                value={form.current_password}
                onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
                autoComplete="current-password"
                placeholder={t("Enter your current password")}
              />
            </div>
            {user?.mfa_enabled && (
              <div>
                <label className={LABEL}>{t("Or authenticator code")}</label>
                <input
                  className="input font-mono"
                  value={form.mfa_code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mfa_code: e.target.value.slice(0, 30) }))
                  }
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  placeholder={t("6-digit code or backup code")}
                />
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => save.mutate()}
            className="btn-primary"
            disabled={
              save.isPending ||
              !form.full_name.trim() ||
              !form.email.trim() ||
              (emailChanged && !hasEmailProof)
            }
          >
            {save.isPending ? t("Saving…") : t("Save profile")}
          </button>
          {saved && (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <Check size={14} /> {saved}
            </span>
          )}
          {error && (
            <span className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</span>
          )}
        </div>
      </div>
      {/* The mill's account is the Boss's to close. */}
      {user?.role === "owner" && <AccountClosureCard />}
    </div>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ElementType }[] = [
  { value: "light", label: t("Light"), icon: Sun },
  { value: "dark", label: t("Dark"), icon: Moon },
];

/** A thumbnail of the app in one theme. Its colours are fixed, so each
 *  thumbnail looks the same whichever theme is on. */
function ThemePreview({ dark }: { dark: boolean }) {
  const panel = dark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200";
  const line = dark ? "bg-slate-600" : "bg-slate-300";
  return (
    <div
      aria-hidden
      className={`flex h-20 overflow-hidden rounded-lg border ${
        dark ? "bg-slate-900 border-slate-700" : "bg-slate-50 border-slate-200"
      }`}
    >
      <div className={`w-6 border-r ${panel}`} />
      <div className="flex-1 space-y-1.5 p-2">
        <div className={`h-2 w-1/2 rounded ${line}`} />
        <div className={`h-8 rounded-md border ${panel}`} />
        <div className="h-2 w-1/3 rounded bg-emerald-500" />
      </div>
    </div>
  );
}

function AppearanceTab() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="space-y-6">
      <div className="card max-w-xl space-y-5">
        <h3 className="text-lg font-bold text-primary">{t("Appearance")}</h3>

        <fieldset>
          <legend className={LABEL}>{t("Theme")}</legend>
          <div className="grid grid-cols-2 gap-3">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = theme === value;
              return (
                <label
                  key={value}
                  className={`cursor-pointer rounded-xl border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500/40 ${
                    active
                      ? "border-emerald-500"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={active}
                    onChange={() => setTheme(value)}
                    className="sr-only"
                  />
                  <ThemePreview dark={value === "dark"} />
                  <span className="mt-3 flex items-center gap-2 text-sm font-semibold text-primary">
                    <Icon size={16} className="text-secondary" />
                    {label}
                    {active && (
                      <Check size={16} className="ml-auto text-emerald-600 dark:text-emerald-400" />
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <LanguagePicker />
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
      setMsg({ type: "ok", text: t("Password changed successfully.") });
      setForm({ current_password: "", new_password: "", confirm: "" });
    },
    onError: (e: any) =>
      setMsg({
        type: "err",
        text: e.response?.data?.detail || t("Failed to change password."),
      }),
  });

  const submit = () => {
    setMsg(null);
    if (form.new_password !== form.confirm)
      return setMsg({ type: "err", text: t("New passwords do not match.") });
    if (form.new_password.length < 8)
      return setMsg({
        type: "err",
        text: t("New password must be at least 8 characters."),
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
          <h3 className="text-lg font-bold text-primary">{t("Change password")}</h3>
        </div>

        {[
          { label: t("Current password"), key: "current_password" },
          { label: t("New password"), key: "new_password" },
          { label: t("Confirm new password"), key: "confirm" },
        ].map(({ label, key }) => (
          <div key={key}>
            <label className={LABEL}>{label}</label>
            <PasswordInput
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
          {change.isPending ? t("Changing…") : t("Change password")}
        </button>
      </div>

      <MfaCard />
      {googleSignInEnabled() && <GoogleIdentityCard />}
    </div>
  );
}

function GoogleIdentityCard() {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const meQ = useQuery({ queryKey: ["auth-me-google"], queryFn: () => authService.me() });
  const [proof, setProof] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const linked = !!meQ.data?.google_linked;
  const usesMfa = !!user?.mfa_enabled;

  const proofBody = () => (usesMfa ? { mfa_code: proof.trim() } : { current_password: proof });

  const link = async (credential?: string) => {
    if (!credential) return;
    setPending(true);
    setError("");
    try {
      await authService.linkGoogle(credential, proofBody());
      await logout();
    } catch (e: any) {
      setError(e.response?.data?.detail || t("Could not link this Google account."));
      setPending(false);
    }
  };

  const unlink = async () => {
    setPending(true);
    setError("");
    try {
      await authService.unlinkGoogle(proofBody());
      await logout();
    } catch (e: any) {
      setError(e.response?.data?.detail || t("Could not unlink this Google account."));
      setPending(false);
    }
  };

  return (
    <div className="card space-y-5">
      <div>
        <h3 className="text-lg font-bold text-primary">{t("Google sign-in")}</h3>
        <p className="text-sm text-secondary mt-1">
          {linked
            ? t("A verified Google identity is linked to this account.")
            : t("Link Google only after confirming your existing account.")}
        </p>
      </div>
      <div>
        <label className={LABEL}>
          {usesMfa ? t("Current authenticator code") : t("Current password")}
        </label>
        {usesMfa ? (
          <input
            type="text"
            className="input"
            value={proof}
            onChange={(e) => setProof(e.target.value.replace(/\D/g, "").slice(0, 6))}
            autoComplete="one-time-code"
          />
        ) : (
          <PasswordInput
            className="input"
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            autoComplete="current-password"
          />
        )}
      </div>
      {error && <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      {linked ? (
        <button
          className="btn-secondary w-full"
          onClick={unlink}
          disabled={pending || !proof.trim()}
        >
          {pending ? t("Unlinking…") : t("Unlink Google")}
        </button>
      ) : proof.trim() ? (
        <div className={pending ? "pointer-events-none opacity-60" : ""}>
          <GoogleLogin
            onSuccess={(response) => void link(response.credential)}
            onError={() => setError(t("Google verification was cancelled or failed."))}
          />
        </div>
      ) : (
        <p className="text-xs text-muted">
          {t("Enter your proof above to enable the Google link button.")}
        </p>
      )}
      <p className="text-xs text-muted">
        {t("Linking or unlinking revokes every active session and requires a fresh sign-in.")}
      </p>
    </div>
  );
}

/** Two-factor authentication management (security hardening P1.9).
 *  Enroll: fetch secret → user adds it to an authenticator app → verify a code.
 *  Recommended (surfaced via mfa_setup_recommended) for owners and platform
 *  admins, but optional unless the account's role is required to use it
 *  (mfa_required): anyone else can turn it off, and back on again with the
 *  authenticator they had (mfa_previous_authenticator) or a new one. */
export function MfaCard() {
  const qc = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const requireReauthentication = useAuthStore((s) => s.requireReauthentication);
  const meQ = useQuery({ queryKey: ["auth-me-mfa"], queryFn: () => authService.me() });
  const [enroll, setEnroll] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  // Switching back on with the authenticator that was on file, so no new secret.
  const [reuse, setReuse] = useState(false);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const mfaEnabled = !!meQ.data?.mfa_enabled;
  const recommended = !!meQ.data?.mfa_setup_recommended;
  const required = !!meQ.data?.mfa_required;
  const previous = !!meQ.data?.mfa_previous_authenticator;
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
      setMsg({ type: "err", text: e.response?.data?.detail || t("Could not start enrollment.") });
    }
  };

  const confirmEnroll = async () => {
    setMsg(null);
    try {
      const res = await authService.mfaEnrollVerify(code.trim());
      setEnroll(null);
      setReuse(false);
      setCode("");
      setBackupCodes(res.backup_codes); // show once
      // The server revoked every pre-MFA session. Pause the global /me poll so
      // the one-time recovery codes remain visible until the user saves them.
      requireReauthentication();
    } catch (e: any) {
      setMsg({ type: "err", text: e.response?.data?.detail || t("Invalid code.") });
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
      setMsg({ type: "err", text: e.response?.data?.detail || t("Invalid code.") });
    }
  };

  const confirmDisable = async () => {
    setMsg(null);
    try {
      await authService.mfaDisable(code.trim(), password);
      await logout();
    } catch (e: any) {
      // A refused attempt doesn't use up the code, so keep it and ask for the
      // password again.
      setPassword("");
      setMsg({ type: "err", text: e.response?.data?.detail || t("Invalid code.") });
    }
  };

  const codeInput = (
    <input
      aria-label={t("Authenticator code")}
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
          <h3 className="text-lg font-bold text-primary">{t("Two-factor authentication")}</h3>
          <p className="text-sm text-secondary">
            {mfaEnabled
              ? t("Enabled. Codes are required at sign-in.")
              : previous
                ? t("Off. Your earlier authenticator is still on file.")
                : t("Add a 6-digit authenticator code to sign-in.")}
          </p>
        </div>
      </div>

      {recommended && !enroll && !reuse && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/15 ring-1 ring-inset ring-amber-500/40 text-sm font-medium text-amber-700 dark:text-amber-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            {t("As a Boss account, turning on two-factor authentication is recommended.")}
          </span>
        </div>
      )}

      {backupCodes && (
        <div className="space-y-4">
          <BackupCodes codes={backupCodes} />
          <button onClick={() => void logout()} className="btn-primary w-full">
            {t("I've saved my codes, sign in again")}
          </button>
        </div>
      )}

      {!mfaEnabled && !enroll && !reuse && !backupCodes && (
        <div className="space-y-3">
          {previous ? (
            <>
              <p className="text-sm text-secondary">
                {t(
                  "Your earlier authenticator is still on file. Switch back on with it, or set up a new one.",
                )}
              </p>
              <button
                onClick={() => {
                  setReuse(true);
                  setMsg(null);
                }}
                className="btn-primary w-full"
              >
                {t("Switch back on with my earlier authenticator")}
              </button>
              <button onClick={start} className="btn-secondary w-full">
                {t("Set up a new authenticator")}
              </button>
              <p className="text-xs text-muted">
                {t("A new authenticator replaces the earlier one.")}
              </p>
            </>
          ) : (
            <button onClick={start} className="btn-primary w-full">
              {t("Enable two-factor authentication")}
            </button>
          )}
        </div>
      )}

      {reuse && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            {t(
              "Enter the 6-digit code your earlier authenticator shows now. It can't be the code you used to turn two-factor off, so if it is refused, wait for the next one.",
            )}
          </p>
          {codeInput}
          <div className="flex gap-2">
            <button
              onClick={confirmEnroll}
              className="btn-primary flex-1"
              disabled={code.length < 6}
            >
              {t("Confirm & enable")}
            </button>
            <button
              onClick={() => {
                setReuse(false);
                setCode("");
                setMsg(null);
              }}
              className="btn-secondary flex-1"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}

      {enroll && (
        <div className="space-y-4">
          <TotpSetup secret={enroll.secret} otpauthUri={enroll.otpauth_uri} />
          {codeInput}
          <div className="flex gap-2">
            <button
              onClick={confirmEnroll}
              className="btn-primary flex-1"
              disabled={code.length < 6}
            >
              {t("Confirm & enable")}
            </button>
            <button
              onClick={() => {
                setEnroll(null);
                setCode("");
                setMsg(null);
              }}
              className="btn-secondary flex-1"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}

      {mfaEnabled && !disabling && !regenerating && !backupCodes && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-secondary">
              {t("Recovery codes:")}{" "}
              <span className="font-semibold text-primary">
                {t("{{codesRemaining}} left", { codesRemaining })}
              </span>
              {codesRemaining <= 3 && (
                <span className="text-amber-600 dark:text-amber-400"> {t("· running low")}</span>
              )}
            </span>
            <button
              onClick={() => {
                setRegenerating(true);
                setMsg(null);
              }}
              className="font-semibold text-grad-brand hover:opacity-80"
            >
              {t("Regenerate")}
            </button>
          </div>
          {required ? (
            <p className="text-xs text-muted">
              {t("Two-factor authentication is required for your role, so it can't be turned off.")}
            </p>
          ) : (
            <button
              onClick={() => {
                setDisabling(true);
                setMsg(null);
              }}
              className="btn-secondary w-full"
            >
              {t("Disable two-factor authentication")}
            </button>
          )}
        </div>
      )}

      {regenerating && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            {t(
              "Enter a current authenticator code to issue new recovery codes. This invalidates your old codes.",
            )}
          </p>
          {codeInput}
          <div className="flex gap-2">
            <button
              onClick={confirmRegenerate}
              className="btn-primary flex-1"
              disabled={code.length < 6}
            >
              {t("Regenerate codes")}
            </button>
            <button
              onClick={() => {
                setRegenerating(false);
                setCode("");
                setMsg(null);
              }}
              className="btn-secondary flex-1"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}

      {disabling && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            {t(
              "To turn two-factor authentication off, enter your password and a current authenticator code. You will be signed out.",
            )}
          </p>
          <div>
            <label htmlFor="mfa-off-password" className="form-label">
              {t("Password")}
            </label>
            <PasswordInput
              id="mfa-off-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <span className="form-label">{t("Authenticator code")}</span>
            {codeInput}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmDisable}
              className="btn-primary flex-1"
              disabled={code.length < 6 || password.length === 0}
            >
              {t("Disable")}
            </button>
            <button
              onClick={() => {
                setDisabling(false);
                setCode("");
                setPassword("");
                setMsg(null);
              }}
              className="btn-secondary flex-1"
            >
              {t("Cancel")}
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

  return (
    <div className="card max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <MonitorSmartphone size={18} className="text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-primary">{t("Devices & sessions")}</h3>
          <p className="text-sm text-secondary">
            {t(
              "Every device signed in to your account: what it is, its IP address, and the cookies it keeps. Revoke anything you don't recognize.",
            )}
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-secondary">
          <Loader2 size={15} className="animate-spin" /> {t("Loading sessions…")}
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <DeviceSessionCard
              key={s.id}
              session={s}
              onRevoke={s.current ? undefined : () => revokeOne.mutate(s.id)}
              revoking={revokeOne.isPending}
            />
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
          {revokeOthers.isPending ? t("Signing out…") : t("Sign out all other devices")}
        </button>
      )}
    </div>
  );
}
