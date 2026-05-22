import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpCircle, X } from "lucide-react";
import api from "../../services/api";

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
    queryFn: () => api.get("/admin/upgrade-requests/pending-count").then((r) => r.data),
    refetchInterval: 5 * 1000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
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
    <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full">
      <div className="bg-white rounded-xl shadow-lg border border-indigo-200 overflow-hidden animate-[slideIn_0.3s_ease-out]">
        <div className="bg-indigo-50 px-4 py-2 flex items-center gap-2 border-b border-indigo-100">
          <ArrowUpCircle size={16} className="text-indigo-600" />
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700 flex-1">
            New plan request
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="text-indigo-500 hover:text-indigo-700"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
        <Link
          to="/admin/upgrade-requests"
          onClick={() => setDismissed(true)}
          className="block px-4 py-3 hover:bg-slate-50 transition-colors"
        >
          <p className="text-sm font-semibold text-slate-900">
            {toast.company_name || "A tenant"} requested {toast.requested_plan_name || "a plan"}
          </p>
          <p className="text-xs text-indigo-600 mt-1 font-medium">Review now →</p>
        </Link>
      </div>
    </div>
  );
}
