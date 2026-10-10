import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { employeesService } from "../services/EmployeesService";
import { inventoryService } from "../services/InventoryService";
import { format } from "date-fns";
import { Plus, Power, History, ChevronDown, ChevronUp, Search, X, Pencil } from "lucide-react";
import { useFeature } from "../hooks/useFeature";
import UpgradeRequired from "../components/UpgradeRequired";
import LegalNotice from "../components/LegalNotice";
import UserAvatar from "../components/UserAvatar";
import { useAccess } from "../hooks/useAccess";
import GovernmentIdsNotice from "../components/GovernmentIdsNotice";

const EMPLOYMENT_TYPES = [
  { value: "regular", label: "Regular" },
  { value: "probationary", label: "Probationary" },
  { value: "contractual", label: "Contractual" },
  { value: "casual", label: "Casual / Daily" },
];
const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];
const CIVIL_STATUSES = ["single", "married", "widowed", "separated"];
const COMMON_POSITIONS = [
  "Mill Operator",
  "Assistant Operator",
  "Driver",
  "Laborer",
  "Foreman",
  "Cashier",
  "Bookkeeper",
  "Warehouse Keeper",
  "Office Staff",
  "Mechanic",
];

const COLS = ["Name", "Position", "Department", "Branch", "Type", "Hired", "Status", ""];

const EMPTY_FORM = {
  employee_no: "",
  first_name: "",
  middle_name: "",
  last_name: "",
  branch_id: "",
  position: "",
  department: "Operations",
  employment_type: "regular",
  date_hired: format(new Date(), "yyyy-MM-dd"),
  date_terminated: "",
  daily_rate: "",
  monthly_salary: "",
  phone: "",
  email: "",
  address: "",
  birthdate: "",
  gender: "",
  civil_status: "",
  sss_no: "",
  philhealth_no: "",
  pagibig_no: "",
  tin: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relation: "",
  notes: "",
};

function EmployeeRow({
  e,
  onToggle,
  onView,
}: {
  e: any;
  onToggle: () => void;
  onView: () => void;
}) {
  return (
    <tr
      className={`hover:bg-gray-50 dark:hover:bg-slate-900/50 cursor-pointer ${!e.is_active ? "opacity-60" : ""}`}
      onClick={onView}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 dark:text-slate-100">{e.full_name}</div>
        {e.employee_no && (
          <div className="text-xs text-gray-500 dark:text-slate-400 font-mono">
            #{e.employee_no}
          </div>
        )}
      </td>
      <td className="px-4 py-3">{e.position || "—"}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{e.department || "—"}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{e.branch?.name || "—"}</td>
      <td className="px-4 py-3 capitalize">{e.employment_type || "—"}</td>
      <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">
        {e.date_hired ? format(new Date(e.date_hired), "MMM d, yyyy") : "—"}
      </td>
      <td className="px-4 py-3">
        {e.is_active ? (
          <span className="badge-green">Active</span>
        ) : (
          <span className="badge-red">Inactive</span>
        )}
      </td>
      <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
        <button
          onClick={onToggle}
          className={`text-xs inline-flex items-center gap-1 ${e.is_active ? "text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300" : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"}`}
        >
          <Power size={12} />
          {e.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  );
}

export default function EmployeesPage() {
  const hasFeature = useFeature("employees");
  if (!hasFeature) {
    return <UpgradeRequired feature="Employees" requires="Pro or Enterprise plan" />;
  }
  return <EmployeesPageInner />;
}

function EmployeesPageInner() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["employees", branchFilter],
    queryFn: () => employeesService.list(branchFilter),
  });
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: () => inventoryService.getBranches(),
  });

  const matches = (e: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.full_name.toLowerCase().includes(q) ||
      (e.position || "").toLowerCase().includes(q) ||
      (e.employee_no || "").toLowerCase().includes(q) ||
      (e.phone || "").includes(q)
    );
  };
  const active = employees.filter((e: any) => e.is_active && matches(e));
  const inactive = employees.filter((e: any) => !e.is_active && matches(e));

  const create = useMutation({
    mutationFn: (b: typeof form) => employeesService.create(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      employeesService.setActive(id, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });

  const upd = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Employees</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {active.length} active · {inactive.length} deactivated
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              className="input pl-9 w-56"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input w-auto"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            <Plus size={16} /> Add employee
          </button>
        </div>
      </div>

      <GovernmentIdsNotice employees={employees} onOpen={setViewing} />

      {showForm && (
        <div className="card space-y-5">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">New employee</h3>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">Identity</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Employee #
                </label>
                <input
                  className="input"
                  placeholder="auto / EMP-001"
                  value={form.employee_no}
                  onChange={(e) => upd("employee_no", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  First name *
                </label>
                <input
                  className="input"
                  value={form.first_name}
                  onChange={(e) => upd("first_name", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Middle name
                </label>
                <input
                  className="input"
                  value={form.middle_name}
                  onChange={(e) => upd("middle_name", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Last name *
                </label>
                <input
                  className="input"
                  value={form.last_name}
                  onChange={(e) => upd("last_name", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">Employment</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Position
                </label>
                <input
                  className="input"
                  list="positions"
                  placeholder="e.g. Mill Operator"
                  value={form.position}
                  onChange={(e) => upd("position", e.target.value)}
                />
                <datalist id="positions">
                  {COMMON_POSITIONS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Department
                </label>
                <input
                  className="input"
                  placeholder="Operations / Office / Drying"
                  value={form.department}
                  onChange={(e) => upd("department", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Employment type
                </label>
                <select
                  className="input"
                  value={form.employment_type}
                  onChange={(e) => upd("employment_type", e.target.value)}
                >
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Branch
                </label>
                <select
                  className="input"
                  value={form.branch_id}
                  onChange={(e) => upd("branch_id", e.target.value)}
                >
                  <option value="">— Default —</option>
                  {branches.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Date hired
                </label>
                <input
                  type="date"
                  className="input"
                  value={form.date_hired}
                  onChange={(e) => upd("date_hired", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Daily rate (₱)
                </label>
                <input
                  type="number"
                  className="input"
                  placeholder="500"
                  value={form.daily_rate}
                  onChange={(e) => upd("daily_rate", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Monthly salary (₱)
                </label>
                <input
                  type="number"
                  className="input"
                  placeholder="15000"
                  value={form.monthly_salary}
                  onChange={(e) => upd("monthly_salary", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
              Personal & contact
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Phone
                </label>
                <input
                  className="input"
                  placeholder="09xx xxx xxxx"
                  value={form.phone}
                  onChange={(e) => upd("phone", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => upd("email", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Birthdate
                </label>
                <input
                  type="date"
                  className="input"
                  value={form.birthdate}
                  onChange={(e) => upd("birthdate", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Gender
                </label>
                <select
                  className="input"
                  value={form.gender}
                  onChange={(e) => upd("gender", e.target.value)}
                >
                  <option value="">—</option>
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Civil status
                </label>
                <select
                  className="input capitalize"
                  value={form.civil_status}
                  onChange={(e) => upd("civil_status", e.target.value)}
                >
                  <option value="">—</option>
                  {CIVIL_STATUSES.map((s) => (
                    <option key={s} value={s} className="capitalize">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Address
                </label>
                <input
                  className="input"
                  value={form.address}
                  onChange={(e) => upd("address", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
              Government IDs
            </p>
            <LegalNotice kind="employeeData" className="mb-3" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">SSS</label>
                <input
                  className="input font-mono text-sm"
                  value={form.sss_no}
                  onChange={(e) => upd("sss_no", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  PhilHealth
                </label>
                <input
                  className="input font-mono text-sm"
                  value={form.philhealth_no}
                  onChange={(e) => upd("philhealth_no", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Pag-IBIG
                </label>
                <input
                  className="input font-mono text-sm"
                  value={form.pagibig_no}
                  onChange={(e) => upd("pagibig_no", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">TIN</label>
                <input
                  className="input font-mono text-sm"
                  value={form.tin}
                  onChange={(e) => upd("tin", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
              Emergency contact
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">Name</label>
                <input
                  className="input"
                  value={form.emergency_contact_name}
                  onChange={(e) => upd("emergency_contact_name", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Phone
                </label>
                <input
                  className="input"
                  value={form.emergency_contact_phone}
                  onChange={(e) => upd("emergency_contact_phone", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-slate-300 mb-1">
                  Relation
                </label>
                <input
                  className="input"
                  placeholder="Spouse, Parent…"
                  value={form.emergency_contact_relation}
                  onChange={(e) => upd("emergency_contact_relation", e.target.value)}
                />
              </div>
            </div>
          </div>

          {create.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {(create.error as any)?.response?.data?.detail || "Failed to save."}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowForm(false);
                setForm({ ...EMPTY_FORM });
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.first_name || !form.last_name}
            >
              {create.isPending ? "Saving…" : "Save employee"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
            <tr>
              {COLS.map((h) => (
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
            {isLoading && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-8 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading &&
              active.map((e: any) => (
                <EmployeeRow
                  key={e.id}
                  e={e}
                  onView={() => setViewing(e)}
                  onToggle={() => toggle.mutate({ id: e.id, is_active: false })}
                />
              ))}
            {!isLoading && active.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-8 text-center text-gray-400">
                  {search
                    ? "No active employees match your search."
                    : "No active employees yet — add the first one above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-gray-200 dark:border-slate-700 bg-gray-50/50">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                Deactivated history ({inactive.length})
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {inactive.map((e: any) => (
                    <EmployeeRow
                      key={e.id}
                      e={e}
                      onView={() => setViewing(e)}
                      onToggle={() => toggle.mutate({ id: e.id, is_active: true })}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {viewing && (
        <EmployeeProfile
          e={viewing}
          branches={branches}
          onClose={() => setViewing(null)}
          onSaved={setViewing}
        />
      )}
    </div>
  );
}

type FieldSpec = {
  key: keyof typeof EMPTY_FORM;
  label: string;
  kind?: "text" | "email" | "date" | "money" | "select" | "textarea";
  options?: { value: string; label: string }[];
  mono?: boolean;
  /** Spans both columns. */
  wide?: boolean;
  placeholder?: string;
};

const CIVIL_OPTIONS = CIVIL_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}));

/** The profile, section by section. The same list draws the read-only view and
 *  the edit form, so the two always line up. */
const PROFILE_SECTIONS: {
  title: string;
  fields: FieldSpec[];
  /** Only shown while editing (the header already shows these). */
  editOnly?: boolean;
  notice?: boolean;
}[] = [
  {
    title: "Name",
    editOnly: true,
    fields: [
      { key: "first_name", label: "First name *" },
      { key: "last_name", label: "Last name *" },
      { key: "middle_name", label: "Middle name" },
      { key: "employee_no", label: "Employee #", mono: true, placeholder: "EMP-001" },
    ],
  },
  {
    title: "Employment",
    fields: [
      { key: "position", label: "Position", placeholder: "e.g. Mill Operator" },
      { key: "department", label: "Department", placeholder: "Operations / Office" },
      {
        key: "employment_type",
        label: "Employment type",
        kind: "select",
        options: EMPLOYMENT_TYPES,
      },
      { key: "branch_id", label: "Branch", kind: "select" },
      { key: "date_hired", label: "Date hired", kind: "date" },
      { key: "date_terminated", label: "Date terminated", kind: "date" },
      { key: "daily_rate", label: "Daily rate", kind: "money", placeholder: "500" },
      { key: "monthly_salary", label: "Monthly salary", kind: "money", placeholder: "15000" },
    ],
  },
  {
    title: "Contact",
    fields: [
      { key: "phone", label: "Phone", placeholder: "09xx xxx xxxx" },
      { key: "email", label: "Email", kind: "email" },
      { key: "address", label: "Address", wide: true },
    ],
  },
  {
    title: "Personal",
    fields: [
      { key: "birthdate", label: "Birthdate", kind: "date" },
      { key: "gender", label: "Gender", kind: "select", options: GENDERS },
      { key: "civil_status", label: "Civil status", kind: "select", options: CIVIL_OPTIONS },
    ],
  },
  {
    title: "Government IDs",
    notice: true,
    fields: [
      { key: "sss_no", label: "SSS", mono: true },
      { key: "philhealth_no", label: "PhilHealth", mono: true },
      { key: "pagibig_no", label: "Pag-IBIG", mono: true },
      { key: "tin", label: "TIN", mono: true },
    ],
  },
  {
    title: "Emergency contact",
    fields: [
      { key: "emergency_contact_name", label: "Name" },
      { key: "emergency_contact_phone", label: "Phone" },
      { key: "emergency_contact_relation", label: "Relation", placeholder: "Spouse, Parent…" },
    ],
  },
  {
    title: "Notes",
    fields: [{ key: "notes", label: "Notes", kind: "textarea", wide: true }],
  },
];

/** An employee record as form values: every field a string, never null. */
function toForm(e: any): typeof EMPTY_FORM {
  const form = { ...EMPTY_FORM };
  for (const key of Object.keys(EMPTY_FORM) as (keyof typeof EMPTY_FORM)[]) {
    form[key] = e[key] == null ? "" : String(e[key]);
  }
  return form;
}

const peso = (v: string) => `₱${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const inputType = (kind: FieldSpec["kind"]) =>
  kind === "date" ? "date" : kind === "email" ? "email" : kind === "money" ? "number" : "text";

/** The employee's profile in a centred window: read it, and, for roles that
 *  manage employees (the Boss included), edit it in place. */
function EmployeeProfile({
  e,
  branches,
  onClose,
  onSaved,
}: {
  e: any;
  branches: any[];
  onClose: () => void;
  onSaved: (updated: any) => void;
}) {
  const { canEdit } = useAccess();
  const mayEdit = canEdit("employees");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(e));
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => employeesService.update(e.id, form),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      onSaved(updated);
      setEditing(false);
    },
  });

  const startEdit = () => {
    setForm(toForm(e));
    save.reset();
    setEditing(true);
  };

  // Escape backs out of editing first, then closes the window.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (editing) setEditing(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  const branchOptions = branches.map((b: any) => ({ value: String(b.id), label: b.name }));
  const optionsFor = (f: FieldSpec) => (f.key === "branch_id" ? branchOptions : (f.options ?? []));

  const shown = (f: FieldSpec): string => {
    const raw = e[f.key];
    if (raw == null || raw === "") return "—";
    if (f.key === "branch_id") return e.branch?.name ?? "—";
    if (f.kind === "select")
      return optionsFor(f).find((o) => o.value === raw)?.label ?? String(raw);
    if (f.kind === "date") return format(new Date(raw), "MMM d, yyyy");
    if (f.kind === "money") return peso(raw);
    return String(raw);
  };

  const input = (f: FieldSpec) => {
    const common = {
      id: `emp-${f.key}`,
      className: `input ${f.mono ? "font-mono text-sm" : ""}`,
      value: form[f.key],
      onChange: (
        ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
      ) => setForm((cur) => ({ ...cur, [f.key]: ev.target.value })),
    };
    if (f.kind === "select") {
      return (
        <select {...common}>
          <option value="">{f.key === "branch_id" ? "— Default —" : "—"}</option>
          {optionsFor(f).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (f.kind === "textarea") return <textarea rows={3} {...common} />;
    return (
      <input
        {...common}
        type={inputType(f.kind)}
        placeholder={f.placeholder}
        list={f.key === "position" ? "positions" : undefined}
      />
    );
  };

  // Rendered into <body>: the page content sits in an animated (transformed)
  // wrapper, and a transformed ancestor would trap this fixed layer inside it
  // instead of letting it cover and centre on the whole screen.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="employee-profile-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
        onClick={() => !editing && onClose()}
      />
      <div className="relative flex w-full max-w-2xl max-h-[88vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-soft animate-grad-fade-up dark:bg-slate-800">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-soft px-6 py-5">
          <UserAvatar className="h-14 w-14" name={e.full_name} />
          <div className="min-w-0 flex-1">
            <h3 id="employee-profile-title" className="truncate text-lg font-bold text-primary">
              {e.full_name}
            </h3>
            <p className="text-sm text-secondary">
              {e.position || "No position yet"}
              {e.department ? ` · ${e.department}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {e.is_active ? (
                <span className="badge-green">Active</span>
              ) : (
                <span className="badge-red">Inactive</span>
              )}
              {e.employment_type && (
                <span className="badge-gray">
                  {EMPLOYMENT_TYPES.find((t) => t.value === e.employment_type)?.label ??
                    e.employment_type}
                </span>
              )}
              {e.branch?.name && <span className="badge-gray">{e.branch.name}</span>}
              {e.employee_no && (
                <span className="font-mono text-xs text-muted">#{e.employee_no}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {mayEdit && !editing && (
              <button type="button" onClick={startEdit} className="btn-secondary !py-1.5 text-sm">
                <Pencil size={14} /> Edit
              </button>
            )}
            <button type="button" aria-label="Close" onClick={onClose} className="btn-ghost !p-1.5">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {PROFILE_SECTIONS.filter((s) => editing || !s.editOnly).map((section) => (
            <section key={section.title}>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
                {section.title}
              </h4>
              {editing && section.notice && <LegalNotice kind="employeeData" className="mb-3" />}
              {editing ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {section.fields.map((f) => (
                    <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                      <label
                        htmlFor={`emp-${f.key}`}
                        className="mb-1 block text-xs font-semibold text-secondary"
                      >
                        {f.label}
                      </label>
                      {input(f)}
                    </div>
                  ))}
                </div>
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  {section.fields.map((f) => (
                    <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                      <dt className="text-xs font-medium text-muted">{f.label}</dt>
                      <dd
                        className={`mt-0.5 text-sm font-medium text-primary ${
                          f.mono ? "font-mono" : ""
                        } ${f.kind === "textarea" ? "whitespace-pre-line" : ""}`}
                      >
                        {shown(f)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
        </div>

        {/* Footer, while editing */}
        {editing && (
          <div className="flex items-center justify-end gap-2 border-t border-soft px-6 py-4">
            {save.isError && (
              <p className="mr-auto text-sm font-medium text-rose-600 dark:text-rose-400">
                {(save.error as any)?.response?.data?.detail || "Couldn't save the changes."}
              </p>
            )}
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              className="btn-primary"
              disabled={save.isPending || !form.first_name.trim() || !form.last_name.trim()}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
