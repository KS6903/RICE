import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../../services/api";
import { Search } from "lucide-react";
import { format } from "date-fns";

export default function AdminUsers() {
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get("/admin/users").then((r) => r.data),
  });

  const filtered = users.filter((u: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.full_name.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.company_name || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">All users</h2>
          <p className="text-sm text-slate-500">{users.length} total · {filtered.length} shown · across all tenants</p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            className="input pl-9 w-72"
            placeholder="Search by name, email, or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Username", "Full name", "Email", "Tenant", "Role", "Status", "Last login"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!isLoading && filtered.map((u: any) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-3 font-medium">{u.full_name}</td>
                <td className="px-4 py-3 text-slate-500">{u.email || "—"}</td>
                <td className="px-4 py-3">
                  {u.company_id ? (
                    <Link to={`/admin/tenants/${u.company_id}`} className="text-indigo-600 hover:text-indigo-700">{u.company_name}</Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 capitalize">{u.role?.replace("_", " ") || "—"}</td>
                <td className="px-4 py-3">{u.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{u.last_login ? format(new Date(u.last_login), "MMM d, HH:mm") : "Never"}</td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No users match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
