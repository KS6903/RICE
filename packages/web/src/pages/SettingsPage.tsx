import { useState, useEffect } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { googleSignInEnabled } from "../utils/googleSignIn";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { billingService } from "../services/BillingService";
import { branchesService } from "../services/BranchesService";
import { activityService } from "../services/ActivityService";
import { authService } from "../services/AuthService";
import { paddyService } from "../services/PaddyService";
import { millingService } from "../services/MillingService";
import { costsService } from "../services/CostsService";
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
  Palette,
  Sun,
  Moon,
  Download,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { useCurrentPlan, useFeature } from "../hooks/useFeature";
import { useAccess } from "../hooks/useAccess";
import { roleLabel, type SubscriptionPlan, type UpgradeRequest } from "@rice-mill/shared";
import ActivityLogList from "../components/activity/ActivityLogList";
import BackupCodes from "../components/BackupCodes";
import TotpSetup from "../components/TotpSetup";
import DataExport from "../components/DataExport";
import Select from "../components/Select";
import ConfirmDialog from "../components/ConfirmDialog";
import DeviceSessionCard from "../components/DeviceSessionCard";
import AccountClosureCard from "../components/AccountClosureCard";
import type { ActivityRow } from "../components/activity/format";
import { Trash2, RotateCcw, Eye, EyeOff } from "lucide-react";

type Tab =
  | "billing"
  | "company"
  | "branches"
  | "varieties"
  | "equipment"
  | "categories"
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
  const { canView, canEdit } = useAccess();
  // The mill's settings are for whoever the Boss opened Settings to (by default
  // the Boss and the Admin). Everyone else manages only their own account.
  const millSettings = canView("settings");
  // The mill's machines are milling's (Basic and up).
  const hasMilling = useFeature("milling");
  const [tab, setTab] = useState<Tab>(millSettings ? "billing" : "profile");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    // The mill's settings. Varieties, machines and expense categories belong to
    // their own pages too, so they also need edit there.
    ...(millSettings
      ? [
          { key: "billing" as Tab, label: "Billing", icon: CreditCard },
          { key: "company" as Tab, label: "Company", icon: Building2 },
          { key: "branches" as Tab, label: "Branches", icon: MapPin },
          ...(canEdit("paddy")
            ? [{ key: "varieties" as Tab, label: "Rice Varieties", icon: Wheat }]
            : []),
          ...(hasMilling && canEdit("milling")
            ? [{ key: "equipment" as Tab, label: "Equipment", icon: Factory }]
            : []),
          ...(canEdit("expenses")
            ? [{ key: "categories" as Tab, label: "Expense Categories", icon: Receipt }]
            : []),
          { key: "activity" as Tab, label: "Activity Log", icon: History },
        ]
      : []),
    // The full data export holds every record, government IDs included: owner only.
    ...(role === "owner" ? [{ key: "data" as Tab, label: "Your Data", icon: Download }] : []),
    // Personal settings — available to every role.
    { key: "profile", label: "My Profile", icon: UserIcon },
    { key: "appearance", label: "Appearance", icon: Palette },
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
  dashboard: "Dashboard",
  paddy: "Paddy procurement",
  inventory: "Inventory tracking",
  sales: "Sales & invoices",
  expenses: "Expense tracking",
  users: "User management",
  milling: "Milling operations",
  dispatch: "Dispatch (deliveries, trucks and drivers)",
  multi_branch: "More than one warehouse",
  field_operators: "Field operators (agents and millers)",
  cash_count: "Cash count",
  collections: "Collections",
  employees: "Employees module",
  reports_advanced: "Advanced reports (AR aging, valuation)",
  compliance_reports: "DA / NFA compliance reports",
  offline_sync: "Offline sync (Electron desktop)",
  canva_inventory: "Visual Warehouse canva (spatial inventory)",
  drying_advisor: "Palay drying advisor",
  automations: "Automations (morning summary, reminders)",
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

  const requestUpgrade = useMutation({
    mutationFn: (plan_id: string) =>
      billingService.createUpgradeRequest({
        plan_id,
        request_type: isOnPaidPlan ? "change" : "upgrade",
        billing_interval: billingInterval,
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
                  {pendingRequest.billing_interval === "annual" && (
                    <span className="badge-green ml-2 !text-[10px] align-middle">Annual</span>
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
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-lg font-bold text-primary">Available plans</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {!canRequest && (
              <span className="text-xs font-medium text-muted">
                Only owners/admins can request upgrades
              </span>
            )}
            <div className="seg" role="group" aria-label="Billing interval">
              <button
                type="button"
                onClick={() => setBillingInterval("monthly")}
                aria-pressed={billingInterval === "monthly"}
                className={`seg-btn ${billingInterval === "monthly" ? "is-active" : ""}`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingInterval("annual")}
                aria-pressed={billingInterval === "annual"}
                className={`seg-btn ${billingInterval === "annual" ? "is-active" : ""}`}
              >
                Annual
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
                  {isCurrent && <span className="ml-auto badge-green">Current</span>}
                </div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {displayPrice === 0 ? "Free" : `₱${displayPrice.toLocaleString()}`}
                  </span>
                  {displayPrice > 0 && (
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                      {isAnnual ? "/yr" : "/mo"}
                    </span>
                  )}
                </div>
                {annualSavingsPct > 0 && (
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 -mt-0.5">
                    Save {annualSavingsPct}% vs monthly
                  </p>
                )}
                <p className="text-sm text-slate-800 dark:text-slate-200 mt-1 mb-2">
                  {p.description}
                </p>
                <div className="text-xs text-slate-700 dark:text-slate-300 font-semibold mb-3">
                  {p.max_users ? `${p.max_users} users` : "Unlimited users"} ·{" "}
                  {p.max_branches
                    ? `${p.max_branches} ${p.max_branches === 1 ? "warehouse" : "warehouses"}`
                    : "Unlimited warehouses"}
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

type VarietyEdit = { id: string; code: string; name: string; category: string; recovery: string };

const VARIETY_CATEGORIES = [
  { value: "inbred", label: "Inbred" },
  { value: "hybrid", label: "Hybrid" },
  { value: "local", label: "Local" },
];

function VarietyRow({
  v,
  onEdit,
  onToggle,
  busy,
}: {
  v: any;
  onEdit: () => void;
  onToggle: () => void;
  busy: boolean;
}) {
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
        {v.company_id ? (
          <span className="badge-green">Custom</span>
        ) : (
          <span className="badge-gray">Default</span>
        )}
      </td>
      <td className="px-4 py-3">
        {v.is_active ? (
          <span className="badge-green">Shown</span>
        ) : (
          <span className="badge-gray">Hidden</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-4">
          <button
            type="button"
            aria-label={`Edit ${v.name}`}
            onClick={onEdit}
            className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            type="button"
            aria-label={`${v.is_active ? "Hide" : "Unhide"} ${v.name}`}
            onClick={onToggle}
            disabled={busy}
            className={`text-xs font-semibold inline-flex items-center gap-1 ${
              v.is_active
                ? "text-rose-600 dark:text-rose-400 hover:text-rose-700"
                : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
            }`}
          >
            {v.is_active ? <EyeOff size={12} /> : <Eye size={12} />}
            {v.is_active ? "Hide" : "Unhide"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function VarietyEditRow({
  edit,
  setEdit,
  onSave,
  onCancel,
  saving,
  error,
}: {
  edit: VarietyEdit;
  setEdit: (e: VarietyEdit) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <tr className="bg-slate-50/60 dark:bg-slate-800/30">
      <td className="px-4 py-2.5">
        <input
          className="input font-mono"
          aria-label="Variety code"
          value={edit.code}
          onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })}
        />
      </td>
      <td className="px-4 py-2.5">
        <input
          className="input"
          aria-label="Variety name"
          value={edit.name}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
        />
        {error && (
          <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>
        )}
      </td>
      <td className="px-4 py-2.5">
        <Select
          aria-label="Variety category"
          value={edit.category}
          onChange={(v) => setEdit({ ...edit, category: v })}
          options={VARIETY_CATEGORIES}
        />
      </td>
      <td className="px-4 py-2.5">
        <input
          className="input"
          type="number"
          aria-label="Typical recovery %"
          value={edit.recovery}
          onChange={(e) => setEdit({ ...edit, recovery: e.target.value })}
        />
      </td>
      <td className="px-4 py-2.5" colSpan={3}>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="btn-primary"
            disabled={saving || !edit.code.trim() || !edit.name.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function VarietiesTab() {
  const qc = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "inbred",
    typical_recovery_pct: "",
  });
  const [editing, setEditing] = useState<VarietyEdit | null>(null);

  const { data: varieties = [] } = useQuery({
    queryKey: ["varieties-all"],
    queryFn: () => paddyService.listVarieties(true),
  });
  const shown = varieties.filter((v: any) => v.is_active);
  const hidden = varieties.filter((v: any) => !v.is_active);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["varieties-all"] });
    qc.invalidateQueries({ queryKey: ["varieties"] });
  };

  const create = useMutation({
    mutationFn: (b: typeof form) =>
      paddyService.createVariety({
        ...b,
        typical_recovery_pct: b.typical_recovery_pct ? parseFloat(b.typical_recovery_pct) : null,
      }),
    onSuccess: () => {
      refresh();
      setShowForm(false);
      setForm({ code: "", name: "", category: "inbred", typical_recovery_pct: "" });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      paddyService.updateVariety(id, { is_active }),
    onSuccess: refresh,
  });

  const save = useMutation({
    mutationFn: (e: VarietyEdit) =>
      paddyService.updateVariety(e.id, {
        code: e.code.trim(),
        name: e.name.trim(),
        category: e.category,
        ...(e.recovery !== "" ? { typical_recovery_pct: parseFloat(e.recovery) } : {}),
      }),
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
  });

  const startEdit = (v: any) => {
    save.reset();
    setEditing({
      id: v.id,
      code: v.code ?? "",
      name: v.name ?? "",
      category: v.category || "inbred",
      recovery: v.typical_recovery_pct != null ? String(Number(v.typical_recovery_pct)) : "",
    });
  };

  const rows = (list: any[]) =>
    list.map((v: any) =>
      editing && editing.id === v.id ? (
        <VarietyEditRow
          key={v.id}
          edit={editing}
          setEdit={setEditing}
          onSave={() => save.mutate(editing)}
          onCancel={() => setEditing(null)}
          saving={save.isPending}
          error={
            save.isError
              ? (save.error as any)?.response?.data?.detail || "Couldn't save the variety."
              : null
          }
        />
      ) : (
        <VarietyRow
          key={v.id}
          v={v}
          onEdit={() => startEdit(v)}
          onToggle={() => toggle.mutate({ id: v.id, is_active: !v.is_active })}
          busy={toggle.isPending}
        />
      ),
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Add your own rice varieties, or edit the default ones (NSIC Rc222 and the rest). Hide a
        variety you don't use: it leaves the lists you pick from until you unhide it.
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
              <Select
                aria-label="Category"
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                options={VARIETY_CATEGORIES}
              />
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
            {rows(shown)}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted font-medium">
                  No varieties shown
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {hidden.length > 0 && (
          <div className="border-t border-soft bg-slate-50/40 dark:bg-slate-800/30">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-secondary hover:text-primary hover:bg-slate-100/50 dark:hover:bg-slate-600/15 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <EyeOff size={14} />
                Hidden varieties ({hidden.length})
              </span>
              {showHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHidden && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
                  {rows(hidden)}
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

type CategoryEdit = { id: string; name: string; is_production_cost: boolean };

const CATEGORY_TYPES = [
  { value: "production", label: "Production" },
  { value: "overhead", label: "Overhead" },
];

function CategoriesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", is_production_cost: true });
  const [editing, setEditing] = useState<CategoryEdit | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => costsService.listCategories(),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["expense-categories"] });

  const create = useMutation({
    mutationFn: (b: typeof form) => costsService.createCategory(b),
    onSuccess: () => {
      refresh();
      setShowForm(false);
      setForm({ name: "", is_production_cost: true });
    },
  });

  const save = useMutation({
    mutationFn: (e: CategoryEdit) =>
      costsService.updateCategory(e.id, { name: e.name, is_production_cost: e.is_production_cost }),
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) =>
      costsService.deleteCategory(id, moveTo),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setDeleting(null);
    },
  });

  const startEdit = (c: any) => {
    save.reset();
    setEditing({ id: c.id, name: c.name, is_production_cost: c.is_production_cost });
  };

  const startDelete = (c: any) => {
    remove.reset();
    const others = categories.filter((o: any) => o.id !== c.id);
    // Default categories first: they're the ones that never go away.
    const target = others.find((o: any) => o.is_default) ?? others[0];
    setMoveTo(target?.id ?? "");
    setDeleting(c);
  };

  const inUse: number = deleting?.expense_count ?? 0;
  const moveOptions = categories
    .filter((o: any) => o.id !== deleting?.id)
    .map((o: any) => ({ value: o.id, label: o.name }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Categorize your expenses (Fuel, Electricity, Labor, etc.). The default categories can be
        renamed or switched between production and overhead, but they can't be deleted. Categories
        you add can be deleted.
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
              placeholder="e.g. Rice hull hauling"
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
              disabled={create.isPending || !form.name.trim()}
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
              {["Name", "Type", "Source", ""].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {categories.map((c: any) =>
              editing && editing.id === c.id ? (
                <tr key={c.id} className="bg-slate-50/60 dark:bg-slate-800/30">
                  <td className="px-4 py-2.5">
                    <input
                      className="input"
                      aria-label="Category name"
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                    {save.isError && (
                      <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                        {(save.error as any)?.response?.data?.detail ||
                          "Couldn't save the category."}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      aria-label="Category type"
                      value={editing.is_production_cost ? "production" : "overhead"}
                      onChange={(v) =>
                        setEditing({ ...editing, is_production_cost: v === "production" })
                      }
                      options={CATEGORY_TYPES}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <CategorySource c={c} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => save.mutate({ ...editing, name: editing.name.trim() })}
                        className="btn-primary"
                        disabled={save.isPending || !editing.name.trim()}
                      >
                        {save.isPending ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
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
                    <CategorySource c={c} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-4">
                      <button
                        type="button"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => startEdit(c)}
                        className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      {!c.is_default && (
                        <button
                          type="button"
                          aria-label={`Delete ${c.name}`}
                          onClick={() => startDelete(c)}
                          className="text-xs font-semibold inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ),
            )}
            {categories.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted font-medium">
                  No categories
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleting}
        danger
        busy={remove.isPending || (inUse > 0 && !moveTo)}
        title={`Delete ${deleting?.name ?? "category"}?`}
        confirmLabel={inUse > 0 ? "Move and delete" : "Delete"}
        onCancel={() => setDeleting(null)}
        onConfirm={() => remove.mutate({ id: deleting.id, moveTo: inUse > 0 ? moveTo : undefined })}
      >
        <div className="space-y-2">
          {inUse > 0 ? (
            <>
              <p>
                {inUse === 1 ? "1 expense is" : `${inUse} expenses are`} filed under it. Choose
                where {inUse === 1 ? "it goes" : "they go"}:
              </p>
              <Select
                aria-label="Move its expenses to"
                value={moveTo}
                onChange={setMoveTo}
                options={moveOptions}
              />
            </>
          ) : (
            <p>No expense is filed under it.</p>
          )}
          {remove.isError && (
            <p className="font-medium text-rose-600 dark:text-rose-400">
              {(remove.error as any)?.response?.data?.detail || "Couldn't delete the category."}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}

function CategorySource({ c }: { c: any }) {
  return c.is_default ? (
    <span className="badge-gray">Default</span>
  ) : (
    <span className="badge-green">Custom</span>
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
            <span>Enable multi-branch mode</span>
          </label>
        </div>
      </div>
      {readOnly ? (
        <p className="text-sm text-secondary">View only: your role can't change these.</p>
      ) : (
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
  // Why some of the selected warehouses were left out of the last bulk delete.
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
          {branches.length} branch{branches.length === 1 ? "" : "es"}
        </p>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowTrash((v) => !v)} className="btn-secondary">
              <History size={16} /> {showTrash ? "Hide history" : "History / Trash"}
            </button>
            <button onClick={() => setShowForm(!showForm)} className="btn-primary">
              <Plus size={16} /> Add branch
            </button>
          </div>
        )}
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
            aria-label="Dismiss"
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
        title={`Move ${selected.size} warehouse${selected.size === 1 ? "" : "s"} to trash?`}
        confirmLabel="Move to trash"
        onCancel={() => setConfirmingBulk(false)}
        onConfirm={() => {
          bulkDelete.mutate([...selected]);
          setConfirmingBulk(false);
        }}
      >
        You can restore {selected.size === 1 ? "it" : "them"} within 30 days.
      </ConfirmDialog>

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
                  disabled={readOnly || selectable.length === 0}
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
                      disabled={readOnly || b.is_main_branch}
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
                    ) : readOnly ? null : (
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
        <h3 className="text-lg font-bold text-primary">Activity log</h3>
        <p className="text-sm text-secondary">
          Who deleted, restored, or purged warehouses, and who downloaded the mill&apos;s data, most
          recent first. It shows the last month; pick other days to look further back, up to{" "}
          {ACTIVITY_MAX_DAYS} days at a time.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="activity-from" className={LABEL}>
            From
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
            To
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
            Last month
          </button>
        )}
      </div>
      {error ? (
        <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
          {(error as any)?.response?.data?.detail || "Couldn't load the activity."}
        </p>
      ) : (
        rows.length >= ACTIVITY_ROW_LIMIT && (
          <p className="text-sm text-secondary">
            Showing the latest {ACTIVITY_ROW_LIMIT}. Pick fewer days to see the rest.
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
      setSaved(emailChanged ? "Verification sent to your new email." : "Saved");
      setError("");
      setTimeout(() => setSaved(""), 3500);
    },
    onError: (e: any) => setError(e.response?.data?.detail || "Failed to update."),
  });

  return (
    <div className="max-w-xl space-y-6">
      <div className="card space-y-5">
        <div className="flex items-center gap-3">
          <UserAvatar className="h-12 w-12" name={user?.full_name || user?.username} />
          <div>
            <h3 className="text-lg font-bold text-primary">My profile</h3>
            <p className="text-xs text-muted font-medium">
              {user?.role_label || roleLabel(user?.role)}
            </p>
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
            required
          />
        </div>
        {emailChanged && (
          <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/20 ring-1 ring-amber-200 dark:ring-amber-800/50 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-primary">Confirm this sensitive change</p>
              <p className="text-xs text-secondary mt-0.5">
                Changing your email signs it out of verified status until you confirm the new
                address.
              </p>
            </div>
            <div>
              <label className={LABEL}>Current password</label>
              <PasswordInput
                className="input"
                value={form.current_password}
                onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
                autoComplete="current-password"
                placeholder="Enter your current password"
              />
            </div>
            {user?.mfa_enabled && (
              <div>
                <label className={LABEL}>Or authenticator code</label>
                <input
                  className="input font-mono"
                  value={form.mfa_code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mfa_code: e.target.value.slice(0, 30) }))
                  }
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  placeholder="6-digit code or backup code"
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
            {save.isPending ? "Saving…" : "Save profile"}
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
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
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
    <div className="card max-w-xl space-y-5">
      <div>
        <h3 className="text-lg font-bold text-primary">Appearance</h3>
        <p className="text-sm text-secondary mt-0.5">
          Your choice is saved to your account on this device. The sign-in and home pages always
          stay light.
        </p>
      </div>

      <fieldset>
        <legend className={LABEL}>Theme</legend>
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
          {change.isPending ? "Changing…" : "Change password"}
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
      setError(e.response?.data?.detail || "Could not link this Google account.");
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
      setError(e.response?.data?.detail || "Could not unlink this Google account.");
      setPending(false);
    }
  };

  return (
    <div className="card space-y-5">
      <div>
        <h3 className="text-lg font-bold text-primary">Google sign-in</h3>
        <p className="text-sm text-secondary mt-1">
          {linked
            ? "A verified Google identity is linked to this account."
            : "Link Google only after confirming your existing account."}
        </p>
      </div>
      <div>
        <label className={LABEL}>
          {usesMfa ? "Current authenticator code" : "Current password"}
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
          {pending ? "Unlinking…" : "Unlink Google"}
        </button>
      ) : proof.trim() ? (
        <div className={pending ? "pointer-events-none opacity-60" : ""}>
          <GoogleLogin
            onSuccess={(response) => void link(response.credential)}
            onError={() => setError("Google verification was cancelled or failed.")}
          />
        </div>
      ) : (
        <p className="text-xs text-muted">
          Enter your proof above to enable the Google link button.
        </p>
      )}
      <p className="text-xs text-muted">
        Linking or unlinking revokes every active session and requires a fresh sign-in.
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
      setMsg({ type: "err", text: e.response?.data?.detail || "Could not start enrollment." });
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
      await authService.mfaDisable(code.trim(), password);
      await logout();
    } catch (e: any) {
      // A refused attempt doesn't use up the code, so keep it and ask for the
      // password again.
      setPassword("");
      setMsg({ type: "err", text: e.response?.data?.detail || "Invalid code." });
    }
  };

  const codeInput = (
    <input
      aria-label="Authenticator code"
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
              ? "Enabled. Codes are required at sign-in."
              : previous
                ? "Off. Your earlier authenticator is still on file."
                : "Add a 6-digit authenticator code to sign-in."}
          </p>
        </div>
      </div>

      {recommended && !enroll && !reuse && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/15 ring-1 ring-inset ring-amber-500/40 text-sm font-medium text-amber-700 dark:text-amber-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>As a Boss account, turning on two-factor authentication is recommended.</span>
        </div>
      )}

      {backupCodes && (
        <div className="space-y-4">
          <BackupCodes codes={backupCodes} />
          <button onClick={() => void logout()} className="btn-primary w-full">
            I&apos;ve saved my codes, sign in again
          </button>
        </div>
      )}

      {!mfaEnabled && !enroll && !reuse && !backupCodes && (
        <div className="space-y-3">
          {previous ? (
            <>
              <p className="text-sm text-secondary">
                Your earlier authenticator is still on file. Switch back on with it, or set up a new
                one.
              </p>
              <button
                onClick={() => {
                  setReuse(true);
                  setMsg(null);
                }}
                className="btn-primary w-full"
              >
                Switch back on with my earlier authenticator
              </button>
              <button onClick={start} className="btn-secondary w-full">
                Set up a new authenticator
              </button>
              <p className="text-xs text-muted">A new authenticator replaces the earlier one.</p>
            </>
          ) : (
            <button onClick={start} className="btn-primary w-full">
              Enable two-factor authentication
            </button>
          )}
        </div>
      )}

      {reuse && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Enter the 6-digit code your earlier authenticator shows now. It can&apos;t be the code
            you used to turn two-factor off, so if it is refused, wait for the next one.
          </p>
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
                setReuse(false);
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
          {required ? (
            <p className="text-xs text-muted">
              Two-factor authentication is required for your role, so it can&apos;t be turned off.
            </p>
          ) : (
            <button
              onClick={() => {
                setDisabling(true);
                setMsg(null);
              }}
              className="btn-secondary w-full"
            >
              Disable two-factor authentication
            </button>
          )}
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
            To turn two-factor authentication off, enter your password and a current authenticator
            code. You will be signed out.
          </p>
          <div>
            <label htmlFor="mfa-off-password" className="form-label">
              Password
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
            <span className="form-label">Authenticator code</span>
            {codeInput}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmDisable}
              className="btn-primary flex-1"
              disabled={code.length < 6 || password.length === 0}
            >
              Disable
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

  return (
    <div className="card max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <MonitorSmartphone size={18} className="text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-primary">Devices &amp; sessions</h3>
          <p className="text-sm text-secondary">
            Every device signed in to your account: what it is, its IP address, and the cookies it
            keeps. Revoke anything you don&apos;t recognize.
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
          {revokeOthers.isPending ? "Signing out…" : "Sign out all other devices"}
        </button>
      )}
    </div>
  );
}
