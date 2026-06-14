import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminService } from "../../services/AdminService";
import { Search, Users as UsersIcon } from "lucide-react";
import { format } from "date-fns";

const COLS = ["Username", "Full name", "Email", "Tenant", "Role", "Status", "Last login"];

export default function AdminUsers() {
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminService.listAllUsers(),
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
          <h2 className="text-2xl font-bold text-primary">All users</h2>
          <p className="text-sm text-muted">
            {users.length} total · {filtered.length} shown · across all tenants
          </p>
        </div>
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            className="input pl-9 w-72"
            placeholder="Search by name, email, or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {COLS.map((_, j) => (
                    <td key={j}>
                      <div className="skeleton h-4" style={{ width: j === 0 ? "60%" : "45%" }} />
                    </td>
                  ))}
                </tr>
              ))}
            {!isLoading &&
              filtered.map((u: any) => (
                <tr key={u.id}>
                  <td className="font-mono text-xs text-secondary">{u.username}</td>
                  <td className="font-medium text-primary">{u.full_name}</td>
                  <td>{u.email || "—"}</td>
                  <td>
                    {u.company_id ? (
                      <Link to={`/admin/tenants/${u.company_id}`} className="link">
                        {u.company_name}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="capitalize">{u.role?.replace("_", " ") || "—"}</td>
                  <td>
                    {u.is_active ? (
                      <span className="badge-green">Active</span>
                    ) : (
                      <span className="badge-gray">Inactive</span>
                    )}
                  </td>
                  <td className="text-xs text-muted">
                    {u.last_login ? format(new Date(u.last_login), "MMM d, HH:mm") : "Never"}
                  </td>
                </tr>
              ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="!py-12 text-center">
                  <UsersIcon size={24} className="mx-auto mb-2 text-muted opacity-60" />
                  <p className="text-sm font-medium text-secondary">
                    {search ? "No users match your search." : "No users yet."}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
