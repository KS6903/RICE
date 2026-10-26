import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CUSTOM_ROLE, roleField, usersService, type UserUpdate } from "../services/UsersService";
import { roleAccessService } from "../services/RoleAccessService";
import PasswordInput from "../components/PasswordInput";
import { KeyRound, Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import ConfirmItsYou, { type Proof } from "../components/ConfirmItsYou";
import TemporaryPasswordDialog from "../components/TemporaryPasswordDialog";
import { ROLES, roleLabel } from "@rice-mill/shared";
import { useAuthStore } from "../stores/authStore";
import { useCurrentPlan } from "../hooks/useFeature";
import Select from "../components/Select";
import ConfirmDialog from "../components/ConfirmDialog";
import RoleAccessPanel, { ROLE_ACCESS_QUERY_KEY } from "../components/RoleAccessPanel";
import { currentLanguage, DEFAULT_LANGUAGE, t } from "../i18n";

const FIELD_LABEL = "block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1";
const ERROR_TEXT = "text-sm font-medium text-rose-600 dark:text-rose-400";

const errorText = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

const roleOptions = (roles: readonly { id: number; label: string }[]) =>
  roles.map((r) => ({ value: String(r.id), label: t(r.label) }));

/** The role picker's value for someone: a built-in role's id, or a made-up one's. */
const roleValueOf = (u: any) =>
  u?.custom_role_id ? `${CUSTOM_ROLE}${u.custom_role_id}` : String(u?.role_id ?? u?.role?.id ?? "");

/** "a Cashier", "an Admin" in English; other languages take the name as it is. */
const withArticle = (label: string) =>
  currentLanguage().code === DEFAULT_LANGUAGE
    ? `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`
    : label;

// Making someone a Boss or an Admin hands over control of the mill, so the
// person doing it confirms with their own password (and an authenticator code,
// if they use one). So does any role that can manage the people here (Users,
// with edit). The server asks for the same.
const CONFIRMED_ROLES: Record<string, string> = { owner: t("a Boss"), admin: t("an Admin") };
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
      <ShieldCheck size={13} aria-hidden /> {t("You confirmed it is you.")}
    </p>
  ) : (
    <p className="mt-1 text-xs text-secondary">
      {t("This role needs your confirmation.")}{" "}
      <button type="button" onClick={onAsk} className="font-semibold text-emerald-600 underline">
        {t("Confirm now")}
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
    setAsking({ form: formName, error: errorText(e, t("That didn't work.")) });
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
      if (!askAgain(e, "edit")) setActionError(errorText(e, t("Couldn't save that change.")));
    },
  });

  // The roles the mill's Boss made up, and what every role opens.
  const { data: roleAccess } = useQuery({
    queryKey: ROLE_ACCESS_QUERY_KEY,
    queryFn: () => roleAccessService.get(),
  });
  const customRoles = roleAccess?.custom_roles ?? [];

  // Only the Boss can change a Boss account or make someone a Boss (the server
  // enforces this too, and that nobody else gives a role opening more than they can).
  const canManage = (u: any) => iAmBoss || u.role?.name !== "owner";
  const customOptions = customRoles.map((r) => ({ value: `${CUSTOM_ROLE}${r.id}`, label: r.name }));
  const allRoleOptions = [...roleOptions(ROLES), ...customOptions];
  const roleChoices = [
    ...roleOptions(ROLES.filter((r) => iAmBoss || r.name !== "owner")),
    ...customOptions,
  ];

  // Whether the role chosen in a form is one that asks you to confirm, and for
  // the edit form, only when it is a change: the form always sends the role.
  const roleNameOf = (id: string) => ROLES.find((r) => String(r.id) === id)?.name ?? "";
  const confirmWhat = (value: string): string | undefined => {
    if (!value) return undefined;
    if (value.startsWith(CUSTOM_ROLE)) {
      const custom = customRoles.find((r) => `${CUSTOM_ROLE}${r.id}` === value);
      return custom?.access.users === "full" ? withArticle(custom.name) : undefined;
    }
    const name = roleNameOf(value);
    if (CONFIRMED_ROLES[name]) return CONFIRMED_ROLES[name];
    const builtIn = roleAccess?.roles.find((r) => r.role === name);
    return builtIn?.access.users === "full" ? withArticle(t(roleLabel(name))) : undefined;
  };
  const usesCode = !!me?.mfa_enabled;
  const createWhat = confirmWhat(form.role_id);
  // The role the person being edited has now, which the form starts on.
  const ownRoleId = roleValueOf(editing);
  const editWhat =
    editing && editing.id !== me?.id && editForm.role_id !== ownRoleId
      ? confirmWhat(editForm.role_id)
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
      role_id: roleValueOf(u),
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
        ...(isMe ? {} : roleField(editForm.role_id)),
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
    if (confirmWhat(role_id)) setAsking({ form: "create" });
  };
  const pickEditRole = (role_id: string) => {
    setEditForm((f) => ({ ...f, role_id }));
    setProof(EMPTY_PROOF);
    if (role_id !== ownRoleId && confirmWhat(role_id)) {
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
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">{t("Users")}</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t(
              "Give each person their own login. Their role decides which pages they see and what they can change.",
            )}
          </p>
          <p
            className={`mt-1.5 text-sm font-semibold ${
              seatsFull ? "text-amber-700 dark:text-amber-300" : "text-gray-700 dark:text-slate-300"
            }`}
          >
            {seatLimit === null
              ? t("{{count}} users. Your plan has no user limit.", { count: seatsUsed })
              : seatsFull
                ? t(
                    "{{seatsUsed}} of {{seatLimit}} users. Every seat is taken: upgrade your plan to add more.",
                    {
                      seatsUsed,
                      seatLimit,
                    },
                  )
                : t("{{seatsUsed}} of {{seatLimit}} users", { seatsUsed, seatLimit })}
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
          <Plus size={16} /> {t("Add User")}
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">{t("New User")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: t("Username"), key: "username", type: "text" },
              { label: t("Full Name"), key: "full_name", type: "text" },
              { label: t("Email"), key: "email", type: "email" },
              { label: t("Password"), key: "password", type: "password" },
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
                {t("Role")}
              </label>
              <Select
                id="new-user-role"
                value={form.role_id}
                onChange={pickCreateRole}
                options={[{ value: "", label: t("-- Select Role --") }, ...roleChoices]}
              />
              {createWhat && (
                <ConfirmedNote proven={proven} onAsk={() => setAsking({ form: "create" })} />
              )}
            </div>
          </div>
          {createUser.isError && (
            <p className={ERROR_TEXT}>
              {errorText(createUser.error, t("Couldn't create that user."))}
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
              {t("Cancel")}
            </button>
            <button
              onClick={createNow}
              className="btn-primary"
              disabled={createUser.isPending || form.role_id === ""}
            >
              {createUser.isPending ? t("Creating…") : t("Create User")}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">
            {t("Edit")} <span className="font-mono text-sm">{editing.username}</span>
            {editing.id === me?.id && <span className="text-muted font-normal"> {t("(you)")}</span>}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={FIELD_LABEL}>{t("Full Name")}</label>
              <input
                className="input"
                value={editForm.full_name}
                onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>{t("Email")}</label>
              <input
                type="email"
                className="input"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="edit-user-role" className={FIELD_LABEL}>
                {t("Role")}
              </label>
              <Select
                id="edit-user-role"
                value={editForm.role_id}
                disabled={editing.id === me?.id}
                onChange={pickEditRole}
                options={editing.id === me?.id ? allRoleOptions : roleChoices}
              />
              {editing.id === me?.id && (
                <p className="text-xs text-muted mt-1">{t("You can't change your own role.")}</p>
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
              {t("Cancel")}
            </button>
            <button onClick={saveEdit} className="btn-primary" disabled={updateUser.isPending}>
              {updateUser.isPending ? t("Saving…") : t("Save changes")}
            </button>
          </div>
        </div>
      )}

      {actionError && !editing && <p className={ERROR_TEXT}>{actionError}</p>}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
            <tr>
              {[t("Username"), t("Full Name"), t("Email"), t("Role"), t("Status"), ""].map(
                (h, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                  >
                    {h}
                  </th>
                ),
              )}
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
                    {isMe && <span className="ml-1 font-normal text-muted">{t("(you)")}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{u.email || "—"}</td>
                  <td className="px-4 py-3">
                    {u.custom_role?.name || (u.role?.name ? t(roleLabel(u.role.name)) : "—")}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="badge-green">{t("Active")}</span>
                    ) : (
                      <span className="badge-red">{t("Removed")}</span>
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
                            title={t("Edit {{username}}", { username: u.username })}
                          >
                            <Pencil size={14} /> {t("Edit")}
                          </button>
                        )}
                        {/* Only the Boss can: it's how a locked-out employee gets back
                            in. Your own password is changed in Settings. */}
                        {iAmBoss && u.is_active && !isMe && (
                          <button
                            type="button"
                            onClick={() => setTempFor(u)}
                            className="btn-ghost !px-2 !py-1.5 text-xs"
                            title={t("Give {{username}} a temporary password", {
                              username: u.username,
                            })}
                            aria-label={t("Give {{username}} a temporary password", {
                              username: u.username,
                            })}
                          >
                            <KeyRound size={14} /> {t("Temporary password")}
                          </button>
                        )}
                        {/* Your own account can't be removed or reset; keep their slots so
                            the Edit buttons line up down the column. */}
                        {iAmBoss && u.is_active && isMe && (
                          <span aria-hidden className="btn-ghost invisible !px-2 !py-1.5 text-xs">
                            <KeyRound size={14} /> {t("Temporary password")}
                          </span>
                        )}
                        {u.is_active && isMe && (
                          <span aria-hidden className="btn-ghost invisible !px-2 !py-1.5 text-xs">
                            <Trash2 size={14} /> {t("Remove")}
                          </span>
                        )}
                        {u.is_active && !isMe && (
                          <button
                            type="button"
                            onClick={() => remove(u)}
                            disabled={updateUser.isPending}
                            className="btn-ghost !px-2 !py-1.5 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                            title={t("Remove {{username}}", { username: u.username })}
                          >
                            <Trash2 size={14} /> {t("Remove")}
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
                            title={t("Restore {{username}}", { username: u.username })}
                          >
                            <RotateCcw size={14} /> {t("Restore")}
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
                  {t("No users yet")}
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
        what={confirmWhat(asking?.form === "edit" ? editForm.role_id : form.role_id) ?? t("a Boss")}
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
        confirmLabel={t("Remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) updateUser.mutate({ id: removing.id, body: { is_active: false } });
          setRemoving(null);
        }}
      >
        {t(
          "They won't be able to sign in any more. Their past records stay, and you can restore them later.",
        )}
      </ConfirmDialog>
    </div>
  );
}
