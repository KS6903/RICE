import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HardHat, Plus, Pencil, Power, X as XIcon, Check, AlertCircle,
  UserCircle2, Factory, Search,
} from "lucide-react";
import { dispatchService } from "../services/DispatchService";
import ColorSwatch from "../components/dispatch/ColorSwatch";
import { useAccess } from "../hooks/useAccess";

type Agent = {
  id: string;
  name: string;
  agent_type: string | null;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  commission_pct: number;
  is_active: boolean;
  canva_color_hex: string | null;
  deactivated_at: string | null;
};

type Miller = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  capacity_kg_per_hr: number | null;
  milling_fee_per_kg: number | null;
  is_active: boolean;
  canva_color_hex: string | null;
  deactivated_at: string | null;
};

type OperatorKind = "agent" | "miller";
type OperatorRow = ({ kind: "agent" } & Agent) | ({ kind: "miller" } & Miller);
type Filter = "all" | "agent" | "miller";
type PageTab = "active" | "deactivated";

const LABEL = "block text-xs font-bold uppercase tracking-wider text-muted mb-1";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function ColorReadOnlyHint() {
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider text-muted bg-slate-100 dark:bg-slate-800/60 px-1 py-0.5 rounded"
      title="Auto-assigned by the system. Unique per contact, and never editable."
    >
      Auto
    </span>
  );
}

function TypeBadge({ kind }: { kind: OperatorKind }) {
  const Icon = kind === "agent" ? UserCircle2 : Factory;
  const style = kind === "agent"
    ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
    : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${style}`}
      data-testid={`type-badge-${kind}`}
    >
      <Icon size={10} />
      {kind === "agent" ? "Agent" : "Miller"}
    </span>
  );
}

export default function FieldOperatorsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <HardHat size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Field Operators</h2>
          <p className="text-sm text-secondary">
            Manage delivery agents and third-party millers — each contact gets a unique color for identification on the canvas.
          </p>
        </div>
      </div>
      <FieldOperatorsContent />
    </div>
  );
}

function FieldOperatorsContent() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [pageTab, setPageTab] = useState<PageTab>("active");
  const [filter, setFilter] = useState<Filter>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["dispatch-agents-all"],
    queryFn: () => dispatchService.listAgents(true),
  });
  const { data: millers = [] } = useQuery<Miller[]>({
    queryKey: ["dispatch-millers-all"],
    queryFn: () => dispatchService.listMillers(true),
  });

  const allRows: OperatorRow[] = useMemo(() => [
    ...agents.map((a): OperatorRow => ({ kind: "agent", ...a })),
    ...millers.map((m): OperatorRow => ({ kind: "miller", ...m })),
  ], [agents, millers]);

  const activeRows: OperatorRow[] = useMemo(() => {
    const active = allRows.filter((r) => r.is_active);
    const filtered = filter === "all" ? active : active.filter((r) => r.kind === filter);
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows, filter]);

  const deactivatedRows: OperatorRow[] = useMemo(() => {
    const inactive = allRows.filter((r) => !r.is_active);
    const searched = search.trim()
      ? inactive.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
      : inactive;
    return searched.sort((a, b) => {
      const ta = a.deactivated_at ? new Date(a.deactivated_at).getTime() : 0;
      const tb = b.deactivated_at ? new Date(b.deactivated_at).getTime() : 0;
      return tb - ta;
    });
  }, [allRows, search]);

  const totalActive = allRows.filter((r) => r.is_active).length;
  const totalDeactivated = allRows.filter((r) => !r.is_active).length;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["dispatch-agents-all"] });
    qc.invalidateQueries({ queryKey: ["dispatch-agents-active"] });
    qc.invalidateQueries({ queryKey: ["dispatch-millers-all"] });
    qc.invalidateQueries({ queryKey: ["dispatch-millers-active"] });
  };

  const toggleActive = useMutation({
    mutationFn: ({ row, is_active }: { row: OperatorRow; is_active: boolean }) =>
      dispatchService.setOperatorActive(row.kind, row.id, is_active),
    onSuccess: (_, { is_active }) => {
      invalidateAll();
      setPageTab(is_active ? "active" : "deactivated");
      setEditingId(null);
      setError(null);
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Action failed."),
  });

  const switchTab = (t: PageTab) => {
    setPageTab(t);
    setEditingId(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      {/* Page-level tab bar */}
      <div className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto">
        {([
          { key: "active" as PageTab, label: "Active", count: totalActive },
          { key: "deactivated" as PageTab, label: "Deactivated", count: totalDeactivated },
        ] as const).map(({ key, label, count }) => {
          const active = pageTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => switchTab(key)}
              data-testid={`operators-page-tab-${key}`}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                active
                  ? "bg-grad-brand text-white shadow-grad-glow"
                  : "text-secondary hover:text-primary hover:bg-slate-100/60 dark:hover:bg-slate-700/30"
              }`}
            >
              {label}
              <span className={`text-xs font-bold tabular-nums ${active ? "text-white/75" : "text-muted"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="card !py-3 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 flex items-center gap-2 text-sm">
          <AlertCircle size={14} className="text-rose-600" />
          <span className="text-rose-900 dark:text-rose-100">{error}</span>
        </div>
      )}

      {/* ── Active tab ── */}
      {pageTab === "active" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div
              className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 ring-1 ring-soft"
              role="tablist"
            >
              {(["all", "agent", "miller"] as const).map((k) => {
                const count =
                  k === "all"
                    ? activeRows.length
                    : k === "agent"
                    ? agents.filter((a) => a.is_active).length
                    : millers.filter((m) => m.is_active).length;
                const label = k === "all" ? "All" : k === "agent" ? "Agents" : "Millers";
                const isActive = filter === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`operators-filter-${k}`}
                    onClick={() => setFilter(k)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      isActive
                        ? "bg-white dark:bg-slate-900 text-primary shadow-sm"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    {label}
                    <span className="ml-1.5 text-[10px] font-bold text-muted tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted">system reserves a unique color per operator</p>
            {canEdit("operators") && (
              <button
                onClick={() => { setShowForm((s) => !s); setEditingId(null); setError(null); }}
                className="btn-primary"
                data-testid="add-operator"
              >
                <Plus size={16} /> Add field operator
              </button>
            )}
          </div>

          {showForm && (
            <NewOperatorForm
              onClose={() => setShowForm(false)}
              onSaved={() => { invalidateAll(); setShowForm(false); setError(null); }}
              setError={setError}
            />
          )}

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm" data-testid="operators-table">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  {["Color", "Name", "Type", "Contact", "Phone", "Details", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeRows.map((row) =>
                  editingId === row.id ? (
                    <EditOperatorRow
                      key={row.id}
                      row={row}
                      onCancel={() => { setEditingId(null); setError(null); }}
                      onSaved={() => { invalidateAll(); setEditingId(null); setError(null); }}
                      setError={setError}
                    />
                  ) : (
                    <ViewOperatorRow
                      key={row.id}
                      row={row}
                      onEdit={() => { setEditingId(row.id); setError(null); }}
                      onDeactivate={() => toggleActive.mutate({ row, is_active: false })}
                      canEdit={canEdit("operators")}
                    />
                  )
                )}
                {activeRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted font-medium">
                      No {filter === "all" ? "active operators" : `active ${filter}s`} yet — add one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Deactivated tab ── */}
      {pageTab === "deactivated" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                className="input !pl-8"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="deactivated-search"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              {deactivatedRows.length} operator{deactivatedRows.length !== 1 ? "s" : ""} · sorted latest to oldest
            </p>
          </div>

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm" data-testid="deactivated-operators-table">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  {["Color", "Name", "Type", "Contact", "Phone", "Details", "Deactivated on", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {deactivatedRows.map((row) => (
                  <DeactivatedOperatorRow
                    key={row.id}
                    row={row}
                    onReactivate={() => toggleActive.mutate({ row, is_active: true })}
                    canEdit={canEdit("operators")}
                  />
                ))}
                {deactivatedRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted font-medium">
                      {search ? "No deactivated operators match your search." : "No deactivated operators."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewOperatorRow({
  row, onEdit, onDeactivate, canEdit,
}: {
  row: OperatorRow;
  onEdit: () => void;
  onDeactivate: () => void;
  canEdit: boolean;
}) {
  const details =
    row.kind === "agent"
      ? row.commission_pct ? `${row.commission_pct}% commission` : "—"
      : row.capacity_kg_per_hr ? `${row.capacity_kg_per_hr} kg/hr` : "—";
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40" data-testid={`operator-row-${row.id}`}>
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5">
          <ColorSwatch color={row.canva_color_hex} label={row.name} size={16} />
          <ColorReadOnlyHint />
        </div>
      </td>
      <td className="px-4 py-3 font-semibold text-primary">{row.name}</td>
      <td className="px-4 py-3"><TypeBadge kind={row.kind} /></td>
      <td className="px-4 py-3 text-secondary">{row.contact_person || "—"}</td>
      <td className="px-4 py-3 text-secondary">{row.phone || "—"}</td>
      <td className="px-4 py-3 text-secondary tabular-nums">{details}</td>
      <td className="px-4 py-3"><span className="badge-green">Active</span></td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={onEdit}
                data-testid={`edit-operator-${row.id}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                type="button"
                onClick={onDeactivate}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <Power size={12} /> Deactivate
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function DeactivatedOperatorRow({
  row, onReactivate, canEdit,
}: {
  row: OperatorRow;
  onReactivate: () => void;
  canEdit: boolean;
}) {
  const details =
    row.kind === "agent"
      ? row.commission_pct ? `${row.commission_pct}% commission` : "—"
      : row.capacity_kg_per_hr ? `${row.capacity_kg_per_hr} kg/hr` : "—";
  return (
    <tr className="opacity-70 hover:opacity-100 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-opacity"
      data-testid={`operator-row-${row.id}`}>
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5">
          <ColorSwatch color={row.canva_color_hex} label={row.name} size={16} />
        </div>
      </td>
      <td className="px-4 py-3 font-semibold text-primary">{row.name}</td>
      <td className="px-4 py-3"><TypeBadge kind={row.kind} /></td>
      <td className="px-4 py-3 text-secondary">{row.contact_person || "—"}</td>
      <td className="px-4 py-3 text-secondary">{row.phone || "—"}</td>
      <td className="px-4 py-3 text-secondary tabular-nums">{details}</td>
      <td className="px-4 py-3 text-secondary tabular-nums text-xs">{formatDate(row.deactivated_at)}</td>
      <td className="px-4 py-3 text-right">
        {canEdit && (
          <button
            type="button"
            onClick={onReactivate}
            data-testid={`reactivate-operator-${row.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          >
            <Power size={12} /> Activate
          </button>
        )}
      </td>
    </tr>
  );
}

function EditOperatorRow({
  row, onCancel, onSaved, setError,
}: {
  row: OperatorRow;
  onCancel: () => void;
  onSaved: () => void;
  setError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(row.name);
  const [contact, setContact] = useState(row.contact_person ?? "");
  const [phone, setPhone] = useState(row.phone ?? "");
  const [address, setAddress] = useState(row.address ?? "");
  const [agentType, setAgentType] = useState(row.kind === "agent" ? row.agent_type ?? "broker" : "broker");
  const [commission, setCommission] = useState(row.kind === "agent" ? String(row.commission_pct ?? "") : "");
  const [capacity, setCapacity] = useState(row.kind === "miller" ? String(row.capacity_kg_per_hr ?? "") : "");
  const [fee, setFee] = useState(row.kind === "miller" ? String(row.milling_fee_per_kg ?? "") : "");

  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: name.trim() || row.name,
        contact_person: contact || null,
        phone: phone || null,
        address: address || null,
      };
      const body =
        row.kind === "agent"
          ? { ...common, agent_type: agentType || null, commission_pct: commission ? parseFloat(commission) : 0 }
          : {
              ...common,
              capacity_kg_per_hr: capacity ? parseFloat(capacity) : null,
              milling_fee_per_kg: fee ? parseFloat(fee) : null,
            };
      return dispatchService.updateOperator(row.kind, row.id, body);
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Save failed."),
  });

  return (
    <tr className="bg-emerald-50/40 dark:bg-emerald-950/15" data-testid={`operator-edit-${row.id}`}>
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5">
          <ColorSwatch color={row.canva_color_hex} label={row.name} size={16} />
          <ColorReadOnlyHint />
        </div>
      </td>
      <td className="px-3 py-2">
        <input className="input !py-1 text-sm" value={name} data-testid="edit-name" onChange={(e) => setName(e.target.value)} />
      </td>
      <td className="px-4 py-3"><TypeBadge kind={row.kind} /></td>
      <td className="px-3 py-2">
        <input className="input !py-1 text-sm" value={contact} placeholder="Contact person" onChange={(e) => setContact(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        <input className="input !py-1 text-sm" value={phone} placeholder="Phone" onChange={(e) => setPhone(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        {row.kind === "agent" ? (
          <div className="flex items-center gap-1.5">
            <select className="input !py-1 text-sm !w-auto" value={agentType} onChange={(e) => setAgentType(e.target.value)}>
              <option value="broker">Broker</option>
              <option value="freelancer">Freelancer</option>
              <option value="logistics_co">Logistics</option>
            </select>
            <input className="input !py-1 text-sm w-16" type="number" step="0.01" placeholder="%" value={commission}
              onChange={(e) => setCommission(e.target.value)} />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input className="input !py-1 text-sm w-20" type="number" step="0.01" placeholder="kg/hr" value={capacity}
              onChange={(e) => setCapacity(e.target.value)} />
            <input className="input !py-1 text-sm w-20" type="number" step="0.0001" placeholder="₱/kg" value={fee}
              onChange={(e) => setFee(e.target.value)} />
          </div>
        )}
      </td>
      <td className="px-4 py-3"><span className="badge-green">Active</span></td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!name.trim() || save.isPending}
            data-testid={`save-operator-${row.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
          >
            <Check size={12} /> {save.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            data-testid={`cancel-operator-${row.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
          >
            <XIcon size={12} /> Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function NewOperatorForm({
  onClose, onSaved, setError,
}: {
  onClose: () => void;
  onSaved: () => void;
  setError: (msg: string | null) => void;
}) {
  const [kind, setKind] = useState<OperatorKind>("agent");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [agentType, setAgentType] = useState("broker");
  const [commission, setCommission] = useState("");
  const [capacity, setCapacity] = useState("");
  const [fee, setFee] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const common = {
        name: name.trim(),
        contact_person: contact || null,
        phone: phone || null,
        address: address || null,
      };
      const body =
        kind === "agent"
          ? { ...common, agent_type: agentType || null, commission_pct: commission ? parseFloat(commission) : 0 }
          : {
              ...common,
              capacity_kg_per_hr: capacity ? parseFloat(capacity) : null,
              milling_fee_per_kg: fee ? parseFloat(fee) : null,
            };
      return dispatchService.createOperator(kind, body);
    },
    onSuccess: () => { onSaved(); },
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Failed to add operator."),
  });

  return (
    <div className="card space-y-4" data-testid="new-operator-form">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-primary">New field operator</h3>
        <button type="button" onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close">
          <XIcon size={16} />
        </button>
      </div>

      <div>
        <label className={LABEL}>Type</label>
        <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 ring-1 ring-soft">
          {(["agent", "miller"] as const).map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`new-operator-kind-${k}`}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${
                kind === k ? "bg-white dark:bg-slate-900 text-primary shadow-sm" : "text-secondary hover:text-primary"
              }`}
            >
              {k === "agent" ? "Agent" : "Miller"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Name *</label>
          <input className="input" data-testid="new-operator-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Contact person</label>
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Address</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        {kind === "agent" ? (
          <>
            <div>
              <label className={LABEL}>Agent type</label>
              <select className="input" value={agentType} onChange={(e) => setAgentType(e.target.value)}>
                <option value="broker">Broker</option>
                <option value="freelancer">Freelancer</option>
                <option value="logistics_co">Logistics company</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Commission %</label>
              <input className="input" type="number" step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={LABEL}>Capacity (kg/hr)</label>
              <input className="input" type="number" step="0.01" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Milling fee per kg (₱)</label>
              <input className="input" type="number" step="0.0001" value={fee} onChange={(e) => setFee(e.target.value)} />
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted">A unique color will be assigned by the system — it can't be picked or changed by anyone.</p>

      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button
          onClick={() => create.mutate()}
          disabled={!name.trim() || create.isPending}
          className="btn-primary"
          data-testid="save-new-operator"
        >
          {create.isPending ? "Saving…" : "Save operator"}
        </button>
      </div>
    </div>
  );
}
