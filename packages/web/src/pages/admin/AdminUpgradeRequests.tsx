import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { format } from "date-fns";
import { Check, X, Loader2, MessageCircle, ArrowRight, Inbox, RefreshCw, TrendingUp } from "lucide-react";
import type { UpgradeRequest } from "@rice-mill/shared";

type FilterStatus = "pending" | "approved" | "rejected" | "cancelled" | "all";

function statusBadge(s: string) {
  const map: Record<string, string> = {
    pending: "badge-yellow",
    approved: "badge-green",
    rejected: "badge-red",
    cancelled: "badge-gray",
  };
  return map[s] || "badge-gray";
}

function RequestRow({ r, onApprove, onReject, busy }: {
  r: UpgradeRequest;
  onApprove: (note: string | null) => void;
  onReject: (note: string | null) => void;
  busy: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const isPlanChange = r.request_type === "change";

  return (
    <tr className="hover:bg-slate-50 align-top">
      <td className="px-4 py-3">
        <Link to={`/admin/tenants/${r.company_id}`} className="font-medium text-indigo-700 hover:text-indigo-900">
          {r.company_name || r.company_id.slice(0, 8)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {isPlanChange
            ? <><RefreshCw size={12} className="text-violet-500 shrink-0" /><span className="text-xs font-semibold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">Plan Change</span></>
            : <><TrendingUp size={12} className="text-indigo-500 shrink-0" /><span className="text-xs font-semibold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">Upgrade</span></>
          }
        </div>
        {isPlanChange && (
          <p className="text-xs text-slate-400 mt-1">Takes effect at end of billing period</p>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        <span className="badge-gray">{r.current_plan_name || "—"}</span>{" "}
        <ArrowRight size={12} className="inline mx-1 text-slate-400" />{" "}
        <span className="font-semibold text-slate-900">{r.requested_plan_name || "—"}</span>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {r.created_at ? format(new Date(r.created_at), "MMM d, yyyy HH:mm") : "—"}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 max-w-[180px]">
        {r.note ? <span className="italic">"{r.note}"</span> : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-4 py-3"><span className={statusBadge(r.status)}>{r.status}</span></td>
      <td className="px-4 py-3">
        {r.status === "pending" ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            {noteOpen && (
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note to tenant…"
                rows={2}
                className="input text-xs"
              />
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onApprove(note || null)}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                <Check size={12} />
                {isPlanChange ? "Queue Change" : "Approve"}
              </button>
              <button
                onClick={() => onReject(note || null)}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-60"
              >
                <X size={12} /> Reject
              </button>
              <button
                onClick={() => setNoteOpen(!noteOpen)}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
              >
                <MessageCircle size={12} /> {noteOpen ? "Hide" : "Note"}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500">
            {r.resolved_at && <div>Resolved {format(new Date(r.resolved_at), "MMM d, yyyy")}</div>}
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
    queryFn: () => api.get(`/admin/upgrade-requests?status_filter=${filter}`).then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: ({ id, admin_note }: { id: string; admin_note: string | null }) =>
      api.post(`/admin/upgrade-requests/${id}/approve`, { admin_note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-upgrade-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-upgrades"] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, admin_note }: { id: string; admin_note: string | null }) =>
      api.post(`/admin/upgrade-requests/${id}/reject`, { admin_note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-upgrade-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-upgrades"] });
    },
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Subscription Requests</h2>
        <p className="text-sm text-slate-500">Tenant upgrade requests and plan change queues</p>
      </div>

      <div className="flex items-center gap-2">
        {(["pending", "approved", "rejected", "cancelled", "all"] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
              filter === s
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-indigo-50/80 via-violet-50/60 to-slate-50/80 border-b border-slate-200">
            <tr>
              {["Tenant", "Type", "Plan", "Requested", "Note", "Status", "Action"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                <Loader2 size={16} className="inline animate-spin mr-2" />Loading…
              </td></tr>
            )}
            {!isLoading && requests.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                <Inbox size={28} className="mx-auto mb-2 text-slate-300" />
                No {filter === "all" ? "" : filter} requests.
              </td></tr>
            )}
            {requests.map((r) => (
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
