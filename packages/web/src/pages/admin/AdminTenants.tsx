import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { format } from "date-fns";
import { Search, ExternalLink, Power, History, ChevronDown, ChevronUp } from "lucide-react";

const COLS = ["Company", "Signed up", "Mode", "Users", "Branches", "Activity", "Status", ""];

function TenantRow({ t, onToggle, busy }: { t: any; onToggle: (next: boolean) => void; busy: boolean }) {
  return (
    <tr className={`hover:bg-slate-50 ${!t.is_active ? "opacity-60" : ""}`}>
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{t.name}</div>
        {t.email && <div className="text-xs text-slate-500">{t.email}</div>}
      </td>
      <td className="px-4 py-3 text-slate-600">{t.created_at ? format(new Date(t.created_at), "MMM d, yyyy") : "—"}</td>
      <td className="px-4 py-3">{t.is_multi_branch ? <span className="badge-green">Multi-branch</span> : <span className="badge-gray">Single</span>}</td>
      <td className="px-4 py-3 font-medium">{t.users_count}</td>
      <td className="px-4 py-3 font-medium">{t.branches_count}</td>
      <td className="px-4 py-3 text-slate-600"><span className="text-xs">{t.purchases_count}p · {t.orders_count}o</span></td>
      <td className="px-4 py-3">{t.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 justify-end">
          <Link to={`/admin/tenants/${t.id}`} className="text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1 text-xs font-medium">
            <ExternalLink size={12} /> Open
          </Link>
          <button
            onClick={() => onToggle(!t.is_active)}
            disabled={busy}
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              t.is_active ? "text-rose-600 hover:text-rose-700" : "text-emerald-600 hover:text-emerald-700"
            }`}
            title={t.is_active ? "Deactivate this tenant (blocks all logins)" : "Reactivate this tenant"}
          >
            <Power size={12} />
            {t.is_active ? "Deactivate" : "Activate"}
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function AdminTenants() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: () => api.get("/admin/tenants").then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/admin/tenants/${id}/active`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tenants"] }),
  });

  const matches = (t: any) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.email || "").toLowerCase().includes(search.toLowerCase());

  const active = tenants.filter((t: any) => t.is_active && matches(t));
  const inactive = tenants.filter((t: any) => !t.is_active && matches(t));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Tenants</h2>
          <p className="text-sm text-slate-500">{active.length} active · {inactive.length} deactivated</p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            className="input pl-9 w-64"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>{COLS.map((h) => <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={COLS.length} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!isLoading && active.map((t: any) => (
              <TenantRow key={t.id} t={t} busy={toggle.isPending} onToggle={(next) => toggle.mutate({ id: t.id, is_active: next })} />
            ))}
            {!isLoading && active.length === 0 && (
              <tr><td colSpan={COLS.length} className="px-4 py-8 text-center text-slate-400">
                {search ? "No active tenants match your search." : "No active tenants."}
              </td></tr>
            )}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50/50">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                Deactivated history ({inactive.length})
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {inactive.map((t: any) => (
                    <TenantRow key={t.id} t={t} busy={toggle.isPending} onToggle={(next) => toggle.mutate({ id: t.id, is_active: next })} />
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
