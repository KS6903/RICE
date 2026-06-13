import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersService } from "../services/UsersService";
import { Plus } from "lucide-react";
import { ROLES } from "@rice-mill/shared";

export default function UsersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersService.list(),
  });

  const [form, setForm] = useState({
    username: "",
    full_name: "",
    email: "",
    password: "",
    role_id: "3",
  });

  const createUser = useMutation({
    mutationFn: (body: typeof form) => usersService.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Users</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">Manage system users and roles</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> Add User
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">New User</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: "Username", key: "username", type: "text" },
              { label: "Full Name", key: "full_name", type: "text" },
              { label: "Email", key: "email", type: "email" },
              { label: "Password", key: "password", type: "password" },
            ].map(({ label, key, type }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  {label}
                </label>
                <input
                  type={type}
                  className="input"
                  value={(form as any)[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Role
              </label>
              <select
                className="input"
                value={form.role_id}
                onChange={(e) => setForm((f) => ({ ...f, role_id: e.target.value }))}
              >
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => createUser.mutate(form)}
              className="btn-primary"
              disabled={createUser.isPending}
            >
              {createUser.isPending ? "Creating…" : "Create User"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
            <tr>
              {["Username", "Full Name", "Email", "Role", "Status"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {users.map((u: any) => (
              <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-3 font-medium">{u.full_name}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{u.email || "—"}</td>
                <td className="px-4 py-3 capitalize">{u.role?.name?.replace("_", " ") || "—"}</td>
                <td className="px-4 py-3">
                  {u.is_active ? (
                    <span className="badge-green">Active</span>
                  ) : (
                    <span className="badge-red">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No users yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
