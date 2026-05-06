import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import api from "../../services/api";
import { format } from "date-fns";
import { ArrowLeft, Building2, MapPin, Users as UsersIcon, Power } from "lucide-react";

export default function AdminTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenant", id],
    queryFn: () => api.get(`/admin/tenants/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const toggle = useMutation({
    mutationFn: (is_active: boolean) => api.put(`/admin/tenants/${id}/active`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant", id] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  if (isLoading || !data) {
    return <div className="text-slate-500">Loading…</div>;
  }

  const c = data.company;
  const m = data.metrics;

  return (
    <div className="space-y-6">
      <Link to="/admin/tenants" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Back to tenants
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Building2 size={22} /> {c.name}
            </h2>
            {c.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}
          </div>
          <p className="text-sm text-slate-500 mt-1">Tenant ID: <span className="font-mono">{c.id}</span></p>
        </div>
        <button
          onClick={() => toggle.mutate(!c.is_active)}
          disabled={toggle.isPending}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm ${
            c.is_active
              ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
          title={c.is_active ? "Deactivate this tenant — blocks all logins" : "Activate this tenant — restores login"}
        >
          <Power size={14} />
          {toggle.isPending ? "Saving…" : c.is_active ? "Deactivate tenant" : "Activate tenant"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Company information</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-slate-500">Address</dt><dd className="text-slate-900">{c.address || "—"}</dd></div>
              <div><dt className="text-slate-500">TIN</dt><dd className="text-slate-900">{c.tin || "—"}</dd></div>
              <div><dt className="text-slate-500">Phone</dt><dd className="text-slate-900">{c.phone || "—"}</dd></div>
              <div><dt className="text-slate-500">Email</dt><dd className="text-slate-900">{c.email || "—"}</dd></div>
              <div><dt className="text-slate-500">NFA License</dt><dd className="text-slate-900">{c.nfa_license_no || "—"}</dd></div>
              <div><dt className="text-slate-500">DA Reg.</dt><dd className="text-slate-900">{c.da_registration_no || "—"}</dd></div>
              <div><dt className="text-slate-500">Currency</dt><dd className="text-slate-900">{c.currency}</dd></div>
              <div><dt className="text-slate-500">Timezone</dt><dd className="text-slate-900">{c.timezone}</dd></div>
              <div><dt className="text-slate-500">Multi-branch</dt><dd className="text-slate-900">{c.is_multi_branch ? "Yes" : "No"}</dd></div>
              <div><dt className="text-slate-500">Signed up</dt><dd className="text-slate-900">{c.created_at ? format(new Date(c.created_at), "MMM d, yyyy 'at' HH:mm") : "—"}</dd></div>
            </dl>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <UsersIcon size={16} className="text-slate-500" />
              <h3 className="font-semibold text-slate-900">Users ({data.users.length})</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>{["Username", "Full name", "Email", "Role", "Status", "Last login"].map(h => <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.users.map((u: any) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-3">{u.full_name}</td>
                    <td className="px-4 py-3 text-slate-500">{u.email || "—"}</td>
                    <td className="px-4 py-3 capitalize">{u.role?.replace("_", " ") || "—"}</td>
                    <td className="px-4 py-3">{u.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{u.last_login ? format(new Date(u.last_login), "MMM d, HH:mm") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <MapPin size={16} className="text-slate-500" />
              <h3 className="font-semibold text-slate-900">Branches ({data.branches.length})</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>{["Name", "Type", "Status"].map(h => <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.branches.map((b: any) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3">{b.is_main_branch ? <span className="badge-green">Main</span> : <span className="badge-gray">Branch</span>}</td>
                    <td className="px-4 py-3">{b.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Activity</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Purchases</dt><dd className="font-semibold">{m.purchases_count.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Milling batches</dt><dd className="font-semibold">{m.batches_count.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Sales orders</dt><dd className="font-semibold">{m.orders_count.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Invoices</dt><dd className="font-semibold">{m.invoices_count.toLocaleString()}</dd></div>
            </dl>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Money</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Revenue</dt><dd className="font-semibold text-emerald-600">₱{m.total_revenue.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Expenses</dt><dd className="font-semibold text-rose-600">₱{m.total_expenses.toLocaleString()}</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
