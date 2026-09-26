import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { employeesService } from "../services/EmployeesService";
import { inventoryService } from "../services/InventoryService";
import { format } from "date-fns";
import {
  Plus,
  Power,
  History,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Mail,
  Phone,
  MapPin,
  IdCard,
} from "lucide-react";
import { useFeature } from "../hooks/useFeature";
import UpgradeRequired from "../components/UpgradeRequired";
import LegalNotice from "../components/LegalNotice";

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

      {viewing && <EmployeeDrawer e={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function EmployeeDrawer({ e, onClose }: { e: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 w-full max-w-lg h-full overflow-y-auto p-6 shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{e.full_name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {e.position || "—"}
              {e.department ? ` · ${e.department}` : ""}
            </p>
            {e.employee_no && <p className="text-xs font-mono text-gray-400">#{e.employee_no}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          {e.is_active ? (
            <span className="badge-green">Active</span>
          ) : (
            <span className="badge-red">Inactive</span>
          )}
          {e.employment_type && <span className="badge-gray capitalize">{e.employment_type}</span>}
          {e.branch?.name && <span className="badge-gray">{e.branch.name}</span>}
        </div>

        <div className="space-y-4 text-sm">
          {(e.phone || e.email || e.address) && (
            <Section title="Contact">
              {e.phone && <Item icon={Phone} label="Phone" value={e.phone} />}
              {e.email && <Item icon={Mail} label="Email" value={e.email} />}
              {e.address && <Item icon={MapPin} label="Address" value={e.address} />}
            </Section>
          )}

          <Section title="Employment">
            <Field
              label="Date hired"
              value={e.date_hired ? format(new Date(e.date_hired), "MMM d, yyyy") : "—"}
            />
            {e.date_terminated && (
              <Field
                label="Date terminated"
                value={format(new Date(e.date_terminated), "MMM d, yyyy")}
              />
            )}
            {e.daily_rate != null && (
              <Field label="Daily rate" value={`₱${Number(e.daily_rate).toLocaleString()}`} />
            )}
            {e.monthly_salary != null && (
              <Field
                label="Monthly salary"
                value={`₱${Number(e.monthly_salary).toLocaleString()}`}
              />
            )}
          </Section>

          {(e.birthdate || e.gender || e.civil_status) && (
            <Section title="Personal">
              {e.birthdate && (
                <Field label="Birthdate" value={format(new Date(e.birthdate), "MMM d, yyyy")} />
              )}
              {e.gender && <Field label="Gender" value={e.gender} className="capitalize" />}
              {e.civil_status && (
                <Field label="Civil status" value={e.civil_status} className="capitalize" />
              )}
            </Section>
          )}

          {(e.sss_no || e.philhealth_no || e.pagibig_no || e.tin) && (
            <Section title="Government IDs">
              {e.sss_no && <Item icon={IdCard} label="SSS" value={e.sss_no} mono />}
              {e.philhealth_no && (
                <Item icon={IdCard} label="PhilHealth" value={e.philhealth_no} mono />
              )}
              {e.pagibig_no && <Item icon={IdCard} label="Pag-IBIG" value={e.pagibig_no} mono />}
              {e.tin && <Item icon={IdCard} label="TIN" value={e.tin} mono />}
            </Section>
          )}

          {(e.emergency_contact_name || e.emergency_contact_phone) && (
            <Section title="Emergency contact">
              <Field label="Name" value={e.emergency_contact_name || "—"} />
              <Field label="Phone" value={e.emergency_contact_phone || "—"} />
              <Field label="Relation" value={e.emergency_contact_relation || "—"} />
            </Section>
          )}

          {e.notes && (
            <Section title="Notes">
              <p className="text-gray-700 dark:text-slate-200 whitespace-pre-line">{e.notes}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
        {title}
      </p>
      <div className="space-y-1.5 pl-1">{children}</div>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`text-gray-900 dark:text-slate-100 text-right ${className || ""}`}>
        {value}
      </span>
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className="text-gray-400 shrink-0" />
      <span className="text-gray-500 dark:text-slate-400 w-20 shrink-0">{label}</span>
      <span className={`text-gray-900 dark:text-slate-100 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}
