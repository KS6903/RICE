import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminService } from "../../services/AdminService";
import { format } from "date-fns";
import { Check, X, MessageCircle, ArrowRight, Inbox, RefreshCw, TrendingUp } from "lucide-react";
import { clsx } from "clsx";
import type { UpgradeRequest } from "@rice-mill/shared";
import { t } from "../../i18n";
import { statusText } from "../../utils/statusText";

type FilterStatus = "pending" | "approved" | "rejected" | "cancelled" | "all";

const COLS = [
  t("Tenant"),
  t("Type"),
  t("Plan"),
  t("Requested"),
  t("Note"),
  t("Status"),
  t("Action"),
];

function statusBadge(s: string) {
  const map: Record<string, string> = {
    pending: "badge-yellow",
    approved: "badge-green",
    rejected: "badge-red",
    cancelled: "badge-gray",
  };
  return map[s] || "badge-gray";
}

function RequestRow({
  r,
  onApprove,
  onReject,
  busy,
}: {
  r: UpgradeRequest;
  onApprove: (note: string | null) => void;
  onReject: (note: string | null) => void;
  busy: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const isPlanChange = r.request_type === "change";

  return (
    <tr className="align-top">
      <td>
        <Link to={`/admin/tenants/${r.company_id}`} className="link font-medium">
          {r.company_name || r.company_id.slice(0, 8)}
        </Link>
      </td>
      <td>
        <span
          className={clsx(
            "inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded",
            isPlanChange
              ? "text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40"
              : "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40",
          )}
        >
          {isPlanChange ? <RefreshCw size={12} /> : <TrendingUp size={12} />}
          {isPlanChange ? t("Plan change") : t("Upgrade")}
        </span>
        {isPlanChange && (
          <p className="text-xs text-muted mt-1">{t("Takes effect at end of billing period")}</p>
        )}
      </td>
      <td>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="badge-gray">{r.current_plan_name || "—"}</span>
          <ArrowRight size={12} className="text-muted" />
          <span className="font-semibold text-primary">{r.requested_plan_name || "—"}</span>
          {r.billing_interval === "annual" && (
            <span className="badge-green !text-[10px] !py-0.5">{t("Annual")}</span>
          )}
        </div>
      </td>
      <td className="text-xs text-muted whitespace-nowrap">
        {r.created_at ? format(new Date(r.created_at), "MMM d, yyyy HH:mm") : "—"}
      </td>
      <td className="max-w-[180px]">
        {r.note ? (
          <span className="italic text-secondary">"{r.note}"</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td>
        <span className={statusBadge(r.status)}>{statusText(r.status)}</span>
      </td>
      <td>
        {r.status === "pending" ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            {noteOpen && (
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("Optional note to tenant…")}
                rows={2}
                className="input text-xs"
              />
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onApprove(note || null)}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 active:scale-[0.97] transition disabled:opacity-60"
              >
                <Check size={12} />
                {isPlanChange ? t("Queue change") : t("Approve")}
              </button>
              <button
                onClick={() => onReject(note || null)}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 active:scale-[0.97] transition disabled:opacity-60"
              >
                <X size={12} /> {t("Reject")}
              </button>
              <button
                onClick={() => setNoteOpen(!noteOpen)}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-secondary transition-colors"
              >
                <MessageCircle size={12} /> {noteOpen ? t("Hide") : t("Note")}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted">
            {r.resolved_at && (
              <div>
                {t("Resolved {{format}}", {
                  format: format(new Date(r.resolved_at), "MMM d, yyyy"),
                })}
              </div>
            )}
            {r.admin_note && <div className="italic mt-0.5">"{r.admin_note}"</div>}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function AdminUpgradeRequests() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterStatus>("pending");

  const { data: requests = [], isLoading } = useQuery<UpgradeRequest[]>({
    queryKey: ["admin-upgrade-requests", filter],
    queryFn: () => adminService.listUpgradeRequests(filter),
  });

  const approve = useMutation({
    mutationFn: ({ id, admin_note }: { id: string; admin_note: string | null }) =>
      adminService.approveRequest(id, { admin_note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-upgrade-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-upgrades"] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, admin_note }: { id: string; admin_note: string | null }) =>
      adminService.rejectRequest(id, { admin_note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-upgrade-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-upgrades"] });
    },
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-primary">{t("Subscription requests")}</h2>
        <p className="text-sm text-muted">{t("Tenant upgrade requests and plan change queues")}</p>
      </div>

      <div className="seg">
        {(["pending", "approved", "rejected", "cancelled", "all"] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={clsx("seg-btn capitalize", filter === s && "is-active")}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              {COLS.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {COLS.map((_, j) => (
                    <td key={j}>
                      <div className="skeleton h-4" style={{ width: j === 0 ? "60%" : "45%" }} />
                    </td>
                  ))}
                </tr>
              ))}
            {!isLoading && requests.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="!py-14 text-center">
                  <Inbox size={28} className="mx-auto mb-2 text-muted opacity-60" />
                  <p className="text-sm font-medium text-secondary">
                    {t("No")} {filter === "all" ? "" : filter} {t("requests.")}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {t("New requests from tenants will appear here.")}
                  </p>
                </td>
              </tr>
            )}
            {!isLoading &&
              requests.map((r) => (
                <RequestRow
                  key={r.id}
                  r={r}
                  busy={busy}
                  onApprove={(admin_note) => approve.mutate({ id: r.id, admin_note })}
                  onReject={(admin_note) => reject.mutate({ id: r.id, admin_note })}
                />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
