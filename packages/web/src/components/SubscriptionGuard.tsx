import { Link, useLocation } from "react-router-dom";
import { Lock, AlertOctagon, Sparkles, CreditCard } from "lucide-react";
import { useAuthStore } from "../stores/authStore";

type SubLockReason =
  "no_subscription" | "expired" | "cancelled" | "past_due" | "no_features" | null;

function lockReason(user: ReturnType<typeof useAuthStore.getState>["user"]): SubLockReason {
  if (!user) return null;
  if (user.is_platform_admin) return null;
  const sub = user.subscription;
  if (!sub) return "no_subscription";
  const status = sub.status;
  if (status === "expired") return "expired";
  if (status === "cancelled") return "cancelled";
  if (status === "past_due") return "past_due";
  const features = user.features ?? [];
  if (features.length === 0) return "no_features";
  return null;
}

export function useSubLock(): SubLockReason {
  const user = useAuthStore((s) => s.user);
  return lockReason(user);
}

const COPY: Record<NonNullable<SubLockReason>, { title: string; body: string; cta: string }> = {
  no_subscription: {
    title: "No active subscription",
    body: "Your company doesn't have a subscription yet. Choose a plan to unlock the rice mill management features.",
    cta: "Choose a plan",
  },
  expired: {
    title: "Your subscription has expired",
    body: "Access to milling, sales, inventory, and other features is paused until your subscription is renewed.",
    cta: "Renew subscription",
  },
  cancelled: {
    title: "Your subscription was cancelled",
    body: "Your plan has been cancelled. Pick a plan to restore access to your data and operations.",
    cta: "Reactivate subscription",
  },
  past_due: {
    title: "Your subscription is past due",
    body: "Payment for your subscription is overdue. Please contact your platform administrator to settle the balance.",
    cta: "View billing",
  },
  no_features: {
    title: "No features assigned to your plan",
    body: "Your current plan doesn't include any features. Please contact your platform administrator.",
    cta: "View billing",
  },
};

export default function SubscriptionGuard({ children }: { children: React.ReactNode }) {
  const reason = useSubLock();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!reason) return <>{children}</>;

  // Always let the user reach /settings so they can renew/upgrade.
  if (location.pathname.startsWith("/settings")) return <>{children}</>;

  const copy = COPY[reason];
  const canRequestUpgrade = user?.role === "owner" || user?.role === "admin";

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-rose-200 dark:border-rose-800 max-w-lg w-full p-8 text-center">
        <div className="w-14 h-14 mx-auto bg-rose-100 dark:bg-rose-900/40 rounded-full flex items-center justify-center mb-4">
          <AlertOctagon size={26} className="text-rose-600 dark:text-rose-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">{copy.title}</h2>
        <p className="text-sm text-gray-600 dark:text-slate-300 mb-4">{copy.body}</p>

        <div className="bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg p-3 text-left text-sm text-rose-900 dark:text-rose-200 mb-5 flex items-start gap-2">
          <Lock size={16} className="text-rose-500 shrink-0 mt-0.5" />
          <span>
            All operational modules (paddy, milling, inventory, sales, expenses, users, reports) are
            locked while your account is inactive.
          </span>
        </div>

        {canRequestUpgrade ? (
          <Link to="/settings" className="btn-primary w-full justify-center inline-flex">
            <CreditCard size={16} />
            {copy.cta}
          </Link>
        ) : (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-left text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              Ask the company owner or administrator to renew the subscription on the billing page.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
