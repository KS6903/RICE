import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersService, type UserUpdate } from "../services/UsersService";
import PasswordInput from "../components/PasswordInput";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ROLES, roleLabel } from "@rice-mill/shared";
import { useAuthStore } from "../stores/authStore";

const FIELD_LABEL = "block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1";
const ERROR_TEXT = "text-sm font-medium text-rose-600 dark:text-rose-400";

const errorText = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

export default function UsersPage() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const iAmBoss = me?.role === "owner";
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ full_name: "", email: "", role_id: "" });
  const [actionError, setActionError] = useState("");

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

  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdate }) => usersService.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditing(null);
      setActionError("");
    },
    onError: (e) => setActionError(errorText(e, "Couldn't save that change.")),
  });

  // Only the Boss can change a Boss account or make someone a Boss (the server
  // enforces this too).
  const canManage = (u: any) => iAmBoss || u.role?.name !== "owner";
  const roleChoices = ROLES.filter((r) => iAmBoss || r.name !== "owner");

  const startEdit = (u: any) => {
    setShowForm(false);
    setActionError("");
    setEditing(u);
    setEditForm({
      full_name: u.full_name ?? "",
      email: u.email ?? "",
      role_id: String(u.role_id ?? u.role?.id ?? ""),
    });
  };

  const saveEdit = () => {
    const isMe = editing.id === me?.id;
    updateUser.mutate({
      id: editing.id,
      body: {
        full_name: editForm.full_name,
        email: editForm.email,
        // Your own role is locked; don't send it.
        ...(isMe ? {} : { role_id: Number(editForm.role_id) }),
      },
    });
  };

  const remove = (u: any) => {
    const ok = window.confirm(
      `Remove ${u.full_name || u.username}?\n\nThey won't be able to sign in any more. ` +
        "Their past records stay, and you can restore them later.",
    );
    if (ok) updateUser.mutate({ id: u.id, body: { is_active: false } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Users</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">Manage system users and roles</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(!showForm);
          }}
          className="btn-primary"
        >
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
                <label className={FIELD_LABEL}>{label}</label>
                {type === "password" ? (
                  <PasswordInput
                    className="input"
                    value={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    autoComplete="new-password"
                  />
                ) : (
                  <input
                    type={type}
                    className="input"
                    value={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <div>
              <label className={FIELD_LABEL}>Role</label>
              <select
                className="input"
                value={form.role_id}
                onChange={(e) => setForm((f) => ({ ...f, role_id: e.target.value }))}
              >
                {roleChoices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {createUser.isError && (
            <p className={ERROR_TEXT}>
              {errorText(createUser.error, "Couldn't create that user.")}
            </p>
          )}
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

      {editing && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">
            Edit <span className="font-mono text-sm">{editing.username}</span>
            {editing.id === me?.id && <span className="text-muted font-normal"> (you)</span>}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={FIELD_LABEL}>Full Name</label>
              <input
                className="input"
                value={editForm.full_name}
                onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>Email</label>
              <input
                type="email"
                className="input"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>Role</label>
              <select
                className="input"
                value={editForm.role_id}
                disabled={editing.id === me?.id}
                onChange={(e) => setEditForm((f) => ({ ...f, role_id: e.target.value }))}
              >
                {(editing.id === me?.id ? ROLES : roleChoices).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              {editing.id === me?.id && (
                <p className="text-xs text-muted mt-1">You can't change your own role.</p>
              )}
            </div>
          </div>
          {actionError && <p className={ERROR_TEXT}>{actionError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={saveEdit} className="btn-primary" disabled={updateUser.isPending}>
              {updateUser.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}

      {actionError && !editing && <p className={ERROR_TEXT}>{actionError}</p>}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
            <tr>
              {["Username", "Full Name", "Email", "Role", "Status", ""].map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {users.map((u: any) => {
              const isMe = u.id === me?.id;
              return (
                <tr
                  key={u.id}
                  className={`hover:bg-gray-50 dark:hover:bg-slate-900/50 ${u.is_active ? "" : "opacity-60"}`}
                >
                  <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3 font-medium">
                    {u.full_name}
                    {isMe && <span className="ml-1 font-normal text-muted">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{u.email || "—"}</td>
                  <td className="px-4 py-3">{roleLabel(u.role?.name) || "—"}</td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="badge-green">Active</span>
                    ) : (
                      <span className="badge-red">Removed</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canManage(u) && (
                      <div className="flex justify-end gap-1">
                        {u.is_active && (
                          <button
                            type="button"
                            onClick={() => startEdit(u)}
                            className="btn-ghost !px-2 !py-1.5 text-xs"
                            title={`Edit ${u.username}`}
                          >
                            <Pencil size={14} /> Edit
                          </button>
                        )}
                        {/* Your own account can't be removed; keep its slot so
                            the Edit buttons line up down the column. */}
                        {u.is_active && isMe && (
                          <span aria-hidden className="btn-ghost invisible !px-2 !py-1.5 text-xs">
                            <Trash2 size={14} /> Remove
                          </span>
                        )}
                        {u.is_active && !isMe && (
                          <button
                            type="button"
                            onClick={() => remove(u)}
                            disabled={updateUser.isPending}
                            className="btn-ghost !px-2 !py-1.5 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                            title={`Remove ${u.username}`}
                          >
                            <Trash2 size={14} /> Remove
                          </button>
                        )}
                        {!u.is_active && (
                          <button
                            type="button"
                            onClick={() =>
                              updateUser.mutate({ id: u.id, body: { is_active: true } })
                            }
                            disabled={updateUser.isPending}
                            className="btn-ghost !px-2 !py-1.5 text-xs"
                            title={`Restore ${u.username}`}
                          >
                            <RotateCcw size={14} /> Restore
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
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
