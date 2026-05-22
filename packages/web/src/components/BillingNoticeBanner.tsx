import { Link } from "react-router-dom";
import { AlertCircle, X, AlertOctagon } from "lucide-react";
import { useBillingNoticeStore } from "../stores/billingNoticeStore";
import { useAuthStore } from "../stores/authStore";

const DAYS = 1000 * 60 * 60 * 24;

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / DAYS);
}

/**
 * Persistent banner derived from subscription state. Shows automatically when the
 * subscription is expired/cancelled/past_due, or when it expires within 7 days.
 */
function StatusBanner() {
  const user = useAuthStore((s) => s.user);
  if (!user || user.is_platform_admin) return null;
  const sub = user.subscription;

  if (!sub) {
    return (
      <Bar tone="rose" Icon={AlertOctagon}>
        <span>Your company doesn't have a subscription yet. Choose a plan to start.</span>
      </Bar>
    );
  }

  if (sub.status === "expired" || sub.status === "cancelled" || sub.status === "past_due") {
    const label =
      sub.status === "expired"
        ? "Your subscription has expired."
        : sub.status === "cancelled"
          ? "Your subscription has been cancelled."
          : "Your subscription is past due.";
    return (
      <Bar tone="rose" Icon={AlertOctagon}>
        <span>{label} Renew now to restore access.</span>
      </Bar>
    );
  }

  const remaining = daysUntil(sub.expires_at);
  if (remaining !== null && remaining >= 0 && remaining <= 7) {
    return (
      <Bar tone="amber" Icon={AlertCircle}>
        <span>
          Your <b>{sub.name}</b> plan expires in {remaining} day{remaining === 1 ? "" : "s"}.
        </span>
      </Bar>
    );
  }

  return null;
}

function Bar({
  tone,
  Icon,
  children,
}: {
  tone: "rose" | "amber";
  Icon: React.ElementType;
  children: React.ReactNode;
}) {
  const cls =
    tone === "rose"
      ? "bg-rose-50 border-rose-200 text-rose-900"
      : "bg-amber-50 border-amber-200 text-amber-900";
  const iconCls = tone === "rose" ? "text-rose-600" : "text-amber-600";
  const linkCls = tone === "rose" ? "text-rose-800 hover:text-rose-900" : "text-amber-800 hover:text-amber-900";
  return (
    <div className={`border-b px-4 py-2 flex items-center gap-3 text-sm ${cls}`}>
      <Icon size={16} className={`${iconCls} shrink-0`} />
      <span className="flex-1">{children}</span>
      <Link to="/settings" className={`underline font-medium whitespace-nowrap ${linkCls}`}>
        View billing
      </Link>
    </div>
  );
}

/**
 * Transient banner triggered by a 402 API response (via billingNoticeStore).
 * Suppressed when the persistent status banner is already shown.
 */
function TransientBanner() {
  const notice = useBillingNoticeStore((s) => s.notice);
  const dismiss = useBillingNoticeStore((s) => s.dismiss);
  if (!notice) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-3 text-sm text-amber-900">
      <AlertCircle size={16} className="text-amber-600 shrink-0" />
      <span className="flex-1">{notice.message}</span>
      <Link to="/settings" onClick={dismiss} className="text-amber-800 underline hover:text-amber-900 font-medium whitespace-nowrap">
        View plans
      </Link>
      <button onClick={dismiss} className="text-amber-700 hover:text-amber-900" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

export default function BillingNoticeBanner() {
  const user = useAuthStore((s) => s.user);
  const sub = user?.subscription;
  const isCritical =
    !user?.is_platform_admin &&
    (!sub || sub.status === "expired" || sub.status === "cancelled" || sub.status === "past_due");

  return (
    <>
      <StatusBanner />
      {!isCritical && <TransientBanner />}
    </>
  );
}
