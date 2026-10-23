import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersService, type UserUpdate } from "../services/UsersService";
import PasswordInput from "../components/PasswordInput";
import { KeyRound, Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import ConfirmItsYou, { type Proof } from "../components/ConfirmItsYou";
import TemporaryPasswordDialog from "../components/TemporaryPasswordDialog";
import { ROLES, roleLabel } from "@rice-mill/shared";
import { useAuthStore } from "../stores/authStore";
import { useCurrentPlan } from "../hooks/useFeature";
import Select from "../components/Select";
import ConfirmDialog from "../components/ConfirmDialog";
import RoleAccessPanel from "../components/RoleAccessPanel";

const FIELD_LABEL = "block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1";
const ERROR_TEXT = "text-sm font-medium text-rose-600 dark:text-rose-400";

const errorText = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

const roleOptions = (roles: readonly { id: number; label: string }[]) =>
  roles.map((r) => ({ value: String(r.id), label: r.label }));

// Making someone a Boss or an Admin hands over control of the mill, so the
// person doing it confirms with their own password (and an authenticator code,
// if they use one). The server asks for the same.
const CONFIRMED_ROLES: Record<string, string> = { owner: "a Boss", admin: "an Admin" };
const EMPTY_PROOF: Proof = { password: "", code: "" };
/** A new user starts with no role: "-- Select Role --" until one is chosen. */
const EMPTY_USER_FORM = { username: "", full_name: "", email: "", password: "", role_id: "" };

/** Which form is asking to be confirmed, and why the last try was refused when
 *  it is being asked a second time. */
type Asking = { form: "create" | "edit"; error?: string };

/** Under the role: that it is confirmed, or a way to be asked again. */
function ConfirmedNote({ proven, onAsk }: { proven: boolean; onAsk: () => void }) {
  return proven ? (
    <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <ShieldCheck size={13} aria-hidden /> You confirmed it is you.
    </p>
  ) : (
    <p className="mt-1 text-xs text-secondary">
      This role needs your confirmation.{" "}
      <button type="button" onClick={onAsk} className="font-semibold text-emerald-600 underline">
        Confirm now
      </button>
    </p>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const iAmBoss = me?.role === "owner";
  const [showForm, setShowForm] = useOpenOnArrival();
  useEscapeKey(() => setShowForm(false), showForm);
  const [editing, setEditing] = useState<any | null>(null);
  useEscapeKey(() => setEditing(null), !!editing);
  // Who the Boss is giving a temporary password to (a locked-out member of staff).
  const [tempFor, setTempFor] = useState<any | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ full_name: "", email: "", role_id: "" });
  const [actionError, setActionError] = useState("");
  // Your own password and code, typed in the popup that opens when a role that
  // needs it (see CONFIRMED_ROLES) is chosen.
  const [proof, setProof] = useState<Proof>(EMPTY_PROOF);
  const [asking, setAsking] = useState<Asking | null>(null);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersService.list(),
  });
  // Every active login takes one of the plan's seats, the Boss's too; a removed
  // user frees theirs (user_service checks the same count).
  const seatLimit = useCurrentPlan()?.max_users ?? null;
  const seatsUsed = users.filter((u: any) => u.is_active).length;
  const seatsFull = seatLimit !== null && seatsUsed >= seatLimit;

  const [form, setForm] = useState({ ...EMPTY_USER_FORM });

  // A confirmation the server turned down: ask for it again in the popup, with
  // why. Returns whether that was the problem (so the caller has no more to say).
  const askAgain = (e: any, formName: "create" | "edit") => {
    if (e?.response?.data?.code !== "confirm_failed") return false;
    setProof(EMPTY_PROOF);
    setAsking({ form: formName, error: errorText(e, "That didn't work.") });
    return true;
  };

  const createUser = useMutation({
    mutationFn: (body: typeof form & { current_password?: string; mfa_code?: string }) =>
      usersService.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowForm(false);
      // The next person starts from a blank form, role included.
      setForm({ ...EMPTY_USER_FORM });
      setProof(EMPTY_PROOF);
    },
    // A turned-down confirmation (a wrong password, or a code that ran out while
    // the form was being filled in) is asked for again in the popup.
    onError: (e: any) => askAgain(e, "create"),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdate }) => usersService.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditing(null);
      setActionError("");
      setProof(EMPTY_PROOF);
    },
    onError: (e) => {
      if (!askAgain(e, "edit")) setActionError(errorText(e, "Couldn't save that change."));
    },
  });

  // Only the Boss can change a Boss account or make someone a Boss (the server
  // enforces this too).
  const canManage = (u: any) => iAmBoss || u.role?.name !== "owner";
  const roleChoices = ROLES.filter((r) => iAmBoss || r.name !== "owner");

  // Whether the role chosen in a form is one that asks you to confirm, and for
  // the edit form, only when it is a change: the form always sends the role.
  const roleNameOf = (id: string) => ROLES.find((r) => String(r.id) === id)?.name ?? "";
  const usesCode = !!me?.mfa_enabled;
  const createWhat = CONFIRMED_ROLES[roleNameOf(form.role_id)];
  // The role the person being edited has now, which the form starts on.
  const ownRoleId = String(editing?.role_id ?? editing?.role?.id ?? "");
  const editWhat =
    editing && editing.id !== me?.id && editForm.role_id !== ownRoleId
      ? CONFIRMED_ROLES[roleNameOf(editForm.role_id)]
      : undefined;
  const proven = proof.password !== "" && (!usesCode || /^\d{6}$/.test(proof.code));
  const proofFields = {
    current_password: proof.password,
    ...(usesCode ? { mfa_code: proof.code } : {}),
  };

  const startEdit = (u: any) => {
    setShowForm(false);
    setActionError("");
    setProof(EMPTY_PROOF);
    setEditing(u);
    setEditForm({
      full_name: u.full_name ?? "",
      email: u.email ?? "",
      role_id: String(u.role_id ?? u.role?.id ?? ""),
    });
  };

  const saveEdit = () => {
    // The popup opens first when the new role needs confirming and hasn't been.
    if (editWhat && !proven) return setAsking({ form: "edit" });
    const isMe = editing.id === me?.id;
    updateUser.mutate({
      id: editing.id,
      body: {
        full_name: editForm.full_name,
        email: editForm.email,
        // Your own role is locked; don't send it.
        ...(isMe ? {} : { role_id: Number(editForm.role_id) }),
        ...(editWhat ? proofFields : {}),
      },
    });
  };

  const createNow = () => {
    if (createWhat && !proven) return setAsking({ form: "create" });
    createUser.mutate({ ...form, ...(createWhat ? proofFields : {}) });
  };

  // Choosing a role that needs confirming opens the popup at once.
  const pickCreateRole = (role_id: string) => {
    setForm((f) => ({ ...f, role_id }));
    setProof(EMPTY_PROOF);
    if (CONFIRMED_ROLES[roleNameOf(role_id)]) setAsking({ form: "create" });
  };
  const pickEditRole = (role_id: string) => {
    setEditForm((f) => ({ ...f, role_id }));
    setProof(EMPTY_PROOF);
    if (role_id !== ownRoleId && CONFIRMED_ROLES[roleNameOf(role_id)]) {
      setAsking({ form: "edit" });
    }
  };
  // Turning the popup down takes the role back: a new person is left with no
  // role chosen ("Select a role"), and someone already on the staff goes back
  // to the role they have.
  const turnedDown = () => {
    if (asking?.form === "create") setForm((f) => ({ ...f, role_id: "" }));
    else setEditForm((f) => ({ ...f, role_id: ownRoleId }));
    setProof(EMPTY_PROOF);
    setAsking(null);
  };

  const remove = (u: any) => setRemoving(u);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Users</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Give each person their own login. Their role decides which pages they see and what they
            can change.
          </p>
          <p
            className={`mt-1.5 text-sm font-semibold ${
              seatsFull ? "text-amber-700 dark:text-amber-300" : "text-gray-700 dark:text-slate-300"
            }`}
          >
            {seatLimit === null
              ? `${seatsUsed} ${seatsUsed === 1 ? "user" : "users"}. Your plan has no user limit.`
              : `${seatsUsed} of ${seatLimit} users`}
            {seatsFull && ". Every seat is taken: upgrade your plan to add more."}
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setProof(EMPTY_PROOF);
            setShowForm(!showForm);
          }}
          className="btn-primary shrink-0"
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
              <label htmlFor="new-user-role" className={FIELD_LABEL}>
                Role
              </label>
              <Select
                id="new-user-role"
                value={form.role_id}
                onChange={pickCreateRole}
                options={[{ value: "", label: "-- Select Role --" }, ...roleOptions(roleChoices)]}
              />
              {createWhat && (
                <ConfirmedNote proven={proven} onAsk={() => setAsking({ form: "create" })} />
              )}
            </div>
          </div>
          {createUser.isError && (
            <p className={ERROR_TEXT}>
              {errorText(createUser.error, "Couldn't create that user.")}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowForm(false);
                setProof(EMPTY_PROOF);
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={createNow}
              className="btn-primary"
              disabled={createUser.isPending || form.role_id === ""}
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
              <label htmlFor="edit-user-role" className={FIELD_LABEL}>
                Role
              </label>
              <Select
                id="edit-user-role"
                value={editForm.role_id}
                disabled={editing.id === me?.id}
                onChange={pickEditRole}
                options={roleOptions(editing.id === me?.id ? ROLES : roleChoices)}
              />
              {editing.id === me?.id && (
                <p className="text-xs text-muted mt-1">You can't change your own role.</p>
              )}
              {editWhat && (
                <ConfirmedNote proven={proven} onAsk={() => setAsking({ form: "edit" })} />
              )}
            </div>
          </div>
          {actionError && <p className={ERROR_TEXT}>{actionError}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setEditing(null);
                setProof(EMPTY_PROOF);
              }}
              className="btn-secondary"
            >
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
                        {/* Only the Boss can: it's how a locked-out employee gets back
                            in. Your own password is changed in Settings. */}
                        {iAmBoss && u.is_active && !isMe && (
                          <button
                            type="button"
                            onClick={() => setTempFor(u)}
                            className="btn-ghost !px-2 !py-1.5 text-xs"
                            title={`Give ${u.username} a temporary password`}
                            aria-label={`Give ${u.username} a temporary password`}
                          >
                            <KeyRound size={14} /> Temporary password
                          </button>
                        )}
                        {/* Your own account can't be removed or reset; keep their slots so
                            the Edit buttons line up down the column. */}
                        {iAmBoss && u.is_active && isMe && (
                          <span aria-hidden className="btn-ghost invisible !px-2 !py-1.5 text-xs">
                            <KeyRound size={14} /> Temporary password
                          </span>
                        )}
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

      {/* Only the Boss decides which pages each role can open. */}
      {iAmBoss && <RoleAccessPanel />}

      {tempFor && (
        <TemporaryPasswordDialog
          name={tempFor.full_name || tempFor.username}
          issue={() => usersService.issueTemporaryPassword(tempFor.id)}
          onClose={() => setTempFor(null)}
        />
      )}

      <ConfirmItsYou
        open={!!asking}
        what={
          CONFIRMED_ROLES[roleNameOf(asking?.form === "edit" ? editForm.role_id : form.role_id)] ??
          "a Boss"
        }
        usesCode={usesCode}
        error={asking?.error}
        onConfirm={(p) => {
          setProof({ password: p.password, code: p.code });
          setAsking(null);
        }}
        onCancel={turnedDown}
      />

      <ConfirmDialog
        open={!!removing}
        danger
        title={`Remove ${removing?.full_name || removing?.username}?`}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) updateUser.mutate({ id: removing.id, body: { is_active: false } });
          setRemoving(null);
        }}
      >
        They won't be able to sign in any more. Their past records stay, and you can restore them
        later.
      </ConfirmDialog>
    </div>
  );
}
