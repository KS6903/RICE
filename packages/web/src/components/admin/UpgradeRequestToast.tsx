import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpCircle, X } from "lucide-react";
import { adminService } from "../../services/AdminService";
import { t } from "../../i18n";

type PendingPayload = {
  pending: number;
  latest: {
    id: string;
    company_id: string;
    company_name: string | null;
    requested_plan_name: string | null;
    requested_plan_code: string | null;
    created_at: string | null;
  } | null;
};

/**
 * Polls `/admin/upgrade-requests/pending-count` every 5s. When a new pending
 * request appears (latest.id changes), pops a toast in the corner of the admin
 * shell for ~10 seconds with the requester and the plan they asked for.
 */
export default function UpgradeRequestToast() {
  const { data } = useQuery<PendingPayload>({
    queryKey: ["admin-pending-upgrades"],
    queryFn: () => adminService.getPendingCount(),
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });

  const baselineRef = useRef<{ count: number; latestId: string | null } | null>(null);
  const [toast, setToast] = useState<PendingPayload["latest"] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!data) return;
    const latestId = data.latest?.id ?? null;
    const count = data.pending;

    // First snapshot — establish baseline without toasting for existing
    // pending requests the admin already knows about.
    if (baselineRef.current === null) {
      baselineRef.current = { count, latestId };
      return;
    }

    const prev = baselineRef.current;
    // Only toast when a new request truly arrived: the pending count went up,
    // OR the count is the same but the latest id changed (rare: one approved
    // and another arrived between polls). Don't toast on approve/reject where
    // the count drops.
    const arrived =
      (count > prev.count && latestId !== null) ||
      (count === prev.count && count > 0 && latestId !== prev.latestId);

    baselineRef.current = { count, latestId };

    if (arrived) {
      setToast(data.latest);
      setDismissed(false);
    }
  }, [data]);

  useEffect(() => {
    if (!toast || dismissed) return;
    const timer = setTimeout(() => setDismissed(true), 10_000);
    return () => clearTimeout(timer);
  }, [toast, dismissed]);

  if (!toast || dismissed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full animate-grad-fade-up">
      <div className="panel">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-soft">
          <span className="icon-chip icon-chip-brand !h-7 !w-7 !rounded-lg">
            <ArrowUpCircle size={15} />
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-secondary flex-1">
            {t("New plan request")}
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="text-muted hover:text-primary transition-colors"
            aria-label={t("Dismiss")}
          >
            <X size={14} />
          </button>
        </div>
        <Link
          to="/admin/upgrade-requests"
          onClick={() => setDismissed(true)}
          className="block px-4 py-3 transition-colors hover:bg-[rgb(var(--ink)/0.04)]"
        >
          <p className="text-sm font-semibold text-primary">
            {toast.company_name || t("A tenant")} {t("requested")}{" "}
            {toast.requested_plan_name || t("a plan")}
          </p>
          <p className="link text-xs mt-1">{t("Review now →")}</p>
        </Link>
      </div>
    </div>
  );
}
