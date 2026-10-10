import { useMemo, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HardHat,
  Plus,
  Pencil,
  Power,
  X as XIcon,
  Check,
  AlertCircle,
  UserCircle2,
  Factory,
  Sprout,
  Search,
} from "lucide-react";
import { SUPPLIER_TYPES } from "@rice-mill/shared";
import { dispatchService } from "../services/DispatchService";
import { paddyService } from "../services/PaddyService";
import Select from "../components/Select";
import TruncatedText from "../components/TruncatedText";
import { useAccess } from "../hooks/useAccess";
import { useFeature } from "../hooks/useFeature";

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
  deactivated_by: string | null;
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
  deactivated_by: string | null;
};

type Supplier = {
  id: string;
  name: string;
  supplier_type: string | null;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  municipality: string | null;
  province: string | null;
  farmer_id: string | null;
  is_active: boolean;
  canva_color_hex: string | null;
};

type OperatorKind = "agent" | "miller";
type OperatorRow = ({ kind: "agent" } & Agent) | ({ kind: "miller" } & Miller);
// "deactivated" is its own tab: every deactivated contact, whatever its type.
type TypeTab = "all" | "agent" | "miller" | "supplier" | "deactivated";
type StatusTab = "active" | "deactivated";

const LABEL = "block text-xs font-bold uppercase tracking-wider text-muted mb-1";

// The agent type is optional: the first option leaves it blank.
const AGENT_TYPE_OPTIONS = [
  { value: "", label: "None" },
  { value: "broker", label: "Broker" },
  { value: "freelancer", label: "Freelancer" },
  { value: "logistics_co", label: "Logistics company" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Green when the contact is active, red once it is deactivated. */
function StatusDot({ active, name }: { active: boolean; name: string }) {
  const state = active ? "active" : "deactivated";
  return (
    <span
      role="img"
      aria-label={`${name} is ${state}`}
      title={active ? "Active" : "Deactivated"}
      data-testid="status-dot"
      data-status={state}
      className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-rose-500"}`}
    />
  );
}

function TypeBadge({ kind }: { kind: OperatorKind }) {
  const Icon = kind === "agent" ? UserCircle2 : Factory;
  const style =
    kind === "agent"
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

function SupplierTypeBadge({ type }: { type: string | null }) {
  const meta = SUPPLIER_TYPES.find((t) => t.value === type);
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
      data-testid="type-badge-supplier"
    >
      <Sprout size={10} />
      {meta?.label ?? "Supplier"}
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
            Manage delivery agents, third-party millers, and palay suppliers.
          </p>
        </div>
      </div>
      <FieldOperatorsContent />
    </div>
  );
}

function FieldOperatorsContent() {
  const { canEdit } = useAccess();
  const hasPaddy = useFeature("paddy");
  const [typeTab, setTypeTab] = useState<TypeTab>("all");
  const [search, setSearch] = useState("");

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["dispatch-agents-all"],
    queryFn: () => dispatchService.listAgents(true),
  });
  const { data: millers = [] } = useQuery<Miller[]>({
    queryKey: ["dispatch-millers-all"],
    queryFn: () => dispatchService.listMillers(true),
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers-all"],
    queryFn: () => paddyService.listSuppliers(true),
    enabled: hasPaddy,
  });

  // The type tabs count active contacts only; deactivated ones live in their own
  // tab at the far end. "All" spans agents + millers, suppliers are their own tab.
  const tabs = useMemo(() => {
    const activeAgents = agents.filter((a) => a.is_active).length;
    const activeMillers = millers.filter((m) => m.is_active).length;
    const base = [
      { key: "all" as TypeTab, label: "All", count: activeAgents + activeMillers },
      { key: "agent" as TypeTab, label: "Agents", count: activeAgents },
      { key: "miller" as TypeTab, label: "Millers", count: activeMillers },
    ];
    if (hasPaddy) {
      const count = suppliers.filter((s) => s.is_active).length;
      base.push({ key: "supplier" as TypeTab, label: "Suppliers", count });
    }
    const deactivated =
      agents.filter((a) => !a.is_active).length +
      millers.filter((m) => !m.is_active).length +
      (hasPaddy ? suppliers.filter((s) => !s.is_active).length : 0);
    return { types: base, deactivated };
  }, [agents, millers, suppliers, hasPaddy]);

  const tabClass = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
      active
        ? "bg-grad-brand text-white shadow-grad-glow"
        : "text-secondary hover:text-primary hover:bg-slate-100/60 dark:hover:bg-slate-700/30"
    }`;
  const countClass = (active: boolean) =>
    `text-xs font-bold tabular-nums ${active ? "text-white/75" : "text-muted"}`;

  return (
    <div className="space-y-4">
      {/* Tab bar: by type, with Deactivated at the far end */}
      <div className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto">
        {tabs.types.map(({ key, label, count }) => {
          const active = typeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTypeTab(key)}
              data-testid={`operators-filter-${key}`}
              className={tabClass(active)}
            >
              {label}
              <span className={countClass(active)}>{count}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTypeTab("deactivated")}
          data-testid="operators-filter-deactivated"
          className={`${tabClass(typeTab === "deactivated")} ml-auto`}
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-rose-500" />
          Deactivated
          <span className={countClass(typeTab === "deactivated")}>{tabs.deactivated}</span>
        </button>
      </div>

      {typeTab === "deactivated" ? (
        <div className="space-y-6">
          <div className="relative max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
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
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
              >
                <XIcon size={13} />
              </button>
            )}
          </div>

          <div className="space-y-2">
            {hasPaddy && <h3 className="text-sm font-bold text-primary">Agents and millers</h3>}
            <OperatorsPanel
              typeTab="all"
              status="deactivated"
              search={search}
              agents={agents}
              millers={millers}
              canEdit={canEdit("operators")}
            />
          </div>

          {hasPaddy && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-primary">Suppliers</h3>
              <SuppliersPanel
                status="deactivated"
                search={search}
                suppliers={suppliers}
                canEdit={canEdit("paddy")}
              />
            </div>
          )}
        </div>
      ) : typeTab === "supplier" ? (
        <SuppliersPanel
          status="active"
          search=""
          suppliers={suppliers}
          canEdit={canEdit("paddy")}
        />
      ) : (
        <OperatorsPanel
          typeTab={typeTab}
          status="active"
          search=""
          agents={agents}
          millers={millers}
          canEdit={canEdit("operators")}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Operators panel ────────────────────────────

function OperatorsPanel({
  typeTab,
  status,
  search,
  agents,
  millers,
  canEdit,
}: {
  typeTab: "all" | "agent" | "miller";
  status: StatusTab;
  /** Name filter, used by the deactivated list. */
  search: string;
  agents: Agent[];
  millers: Miller[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allRows: OperatorRow[] = useMemo(
    () => [
      ...agents.map((a): OperatorRow => ({ kind: "agent", ...a })),
      ...millers.map((m): OperatorRow => ({ kind: "miller", ...m })),
    ],
    [agents, millers],
  );

  const typeFiltered = useMemo(
    () => (typeTab === "all" ? allRows : allRows.filter((r) => r.kind === typeTab)),
    [allRows, typeTab],
  );

  const rows = useMemo(() => {
    if (status === "active") {
      return typeFiltered.filter((r) => r.is_active).sort((a, b) => a.name.localeCompare(b.name));
    }
    const inactive = typeFiltered.filter((r) => !r.is_active);
    const searched = search.trim()
      ? inactive.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
      : inactive;
    return searched.sort((a, b) => {
      const ta = a.deactivated_at ? new Date(a.deactivated_at).getTime() : 0;
      const tb = b.deactivated_at ? new Date(b.deactivated_at).getTime() : 0;
      return tb - ta;
    });
  }, [typeFiltered, status, search]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["dispatch-agents-all"] });
    qc.invalidateQueries({ queryKey: ["dispatch-agents-active"] });
    qc.invalidateQueries({ queryKey: ["dispatch-millers-all"] });
    qc.invalidateQueries({ queryKey: ["dispatch-millers-active"] });
  };

  const toggleActive = useMutation({
    mutationFn: ({ row, is_active }: { row: OperatorRow; is_active: boolean }) =>
      dispatchService.setOperatorActive(row.kind, row.id, is_active),
    onSuccess: () => {
      invalidateAll();
      setEditingId(null);
      setError(null);
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Action failed."),
  });

  const colSpan = status === "active" ? 8 : 9;
  const headers =
    status === "active"
      ? ["", "Name", "Type", "Contact", "Phone", "Details", "Status", ""]
      : ["", "Name", "Type", "Contact", "Phone", "Details", "Deactivated on", "Deactivated by", ""];

  const renderRow = (row: OperatorRow) => {
    if (status === "deactivated") {
      return (
        <DeactivatedOperatorRow
          key={row.id}
          row={row}
          onReactivate={() => toggleActive.mutate({ row, is_active: true })}
          canEdit={canEdit}
        />
      );
    }
    return editingId === row.id ? (
      <EditOperatorRow
        key={row.id}
        row={row}
        onCancel={() => {
          setEditingId(null);
          setError(null);
        }}
        onSaved={() => {
          invalidateAll();
          setEditingId(null);
          setError(null);
        }}
        setError={setError}
      />
    ) : (
      <ViewOperatorRow
        key={row.id}
        row={row}
        onEdit={() => {
          setEditingId(row.id);
          setError(null);
        }}
        onDeactivate={() => toggleActive.mutate({ row, is_active: false })}
        canEdit={canEdit}
      />
    );
  };

  const GroupHeader = ({
    label,
    count,
    tone,
  }: {
    label: string;
    count: number;
    tone: "agent" | "miller";
  }) => (
    <tr className="border-y border-slate-200 dark:border-slate-700">
      <td
        colSpan={colSpan}
        className={`px-4 py-1.5 ${tone === "agent" ? "bg-violet-50 dark:bg-violet-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}
      >
        <span
          className={`text-[11px] font-bold uppercase tracking-widest ${tone === "agent" ? "text-violet-600 dark:text-violet-400" : "text-amber-600 dark:text-amber-400"}`}
        >
          {label} · {count}
        </span>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {status === "active" && canEdit && (
          <button
            onClick={() => {
              setShowForm((s) => !s);
              setEditingId(null);
              setError(null);
            }}
            className="btn-primary ml-auto"
            data-testid="add-operator"
          >
            <Plus size={16} /> Add field operator
          </button>
        )}
      </div>

      {error && (
        <div className="card !py-3 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 flex items-center gap-2 text-sm">
          <AlertCircle size={14} className="text-rose-600 dark:text-rose-400" />
          <span className="text-rose-900 dark:text-rose-100">{error}</span>
        </div>
      )}

      {status === "active" && showForm && (
        <NewOperatorForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            invalidateAll();
            setShowForm(false);
            setError(null);
          }}
          setError={setError}
        />
      )}

      <div className="card overflow-hidden p-0">
        <table
          className="w-full text-sm"
          data-testid={status === "active" ? "operators-table" : "deactivated-operators-table"}
        >
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-muted font-medium">
                  {status === "active"
                    ? `No active ${typeTab === "all" ? "operators" : typeTab + "s"} yet${canEdit ? ". Add one above." : "."}`
                    : search
                      ? "No deactivated operators match your search."
                      : "No deactivated operators."}
                </td>
              </tr>
            ) : typeTab === "all" ? (
              <>
                {(() => {
                  const agentRows = rows.filter((r) => r.kind === "agent");
                  const millerRows = rows.filter((r) => r.kind === "miller");
                  return (
                    <>
                      {agentRows.length > 0 && (
                        <>
                          <GroupHeader label="Agents" count={agentRows.length} tone="agent" />
                          {agentRows.map(renderRow)}
                        </>
                      )}
                      {millerRows.length > 0 && (
                        <>
                          <GroupHeader label="Millers" count={millerRows.length} tone="miller" />
                          {millerRows.map(renderRow)}
                        </>
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              rows.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ViewOperatorRow({
  row,
  onEdit,
  onDeactivate,
  canEdit,
}: {
  row: OperatorRow;
  onEdit: () => void;
  onDeactivate: () => void;
  canEdit: boolean;
}) {
  const details =
    row.kind === "agent"
      ? row.commission_pct
        ? `${row.commission_pct}% commission`
        : "—"
      : row.capacity_kg_per_hr
        ? `${row.capacity_kg_per_hr} kg/hr`
        : "—";
  return (
    <tr
      className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
      data-testid={`operator-row-${row.id}`}
    >
      <td className="px-4 py-3">
        <StatusDot active name={row.name} />
      </td>
      <td className="px-4 py-3 font-semibold text-primary">{row.name}</td>
      <td className="px-4 py-3">
        <TypeBadge kind={row.kind} />
      </td>
      <td className="px-4 py-3 text-secondary">{row.contact_person || "—"}</td>
      <td className="px-4 py-3 text-secondary">{row.phone || "—"}</td>
      <td className="px-4 py-3 text-secondary tabular-nums">{details}</td>
      <td className="px-4 py-3">
        <span className="badge-green">Active</span>
      </td>
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
  row,
  onReactivate,
  canEdit,
}: {
  row: OperatorRow;
  onReactivate: () => void;
  canEdit: boolean;
}) {
  const details =
    row.kind === "agent"
      ? row.commission_pct
        ? `${row.commission_pct}% commission`
        : "—"
      : row.capacity_kg_per_hr
        ? `${row.capacity_kg_per_hr} kg/hr`
        : "—";
  return (
    <tr
      className="opacity-70 hover:opacity-100 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-opacity"
      data-testid={`operator-row-${row.id}`}
    >
      <td className="px-4 py-3">
        <StatusDot active={false} name={row.name} />
      </td>
      <td className="px-4 py-3 font-semibold text-primary">{row.name}</td>
      <td className="px-4 py-3">
        <TypeBadge kind={row.kind} />
      </td>
      <td className="px-4 py-3 text-secondary">{row.contact_person || "—"}</td>
      <td className="px-4 py-3 text-secondary">{row.phone || "—"}</td>
      <td className="px-4 py-3 text-secondary tabular-nums">{details}</td>
      <td className="px-4 py-3 text-secondary tabular-nums text-xs">
        {formatDate(row.deactivated_at)}
      </td>
      <td className="px-4 py-3 text-secondary text-xs">
        {row.deactivated_by ? (
          <TruncatedText text={row.deactivated_by} className="max-w-[9rem] sm:max-w-[14rem]" />
        ) : (
          "—"
        )}
      </td>
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
  row,
  onCancel,
  onSaved,
  setError,
}: {
  row: OperatorRow;
  onCancel: () => void;
  onSaved: () => void;
  setError: (msg: string | null) => void;
}) {
  useEscapeKey(onCancel);
  const [name, setName] = useState(row.name);
  const [contact, setContact] = useState(row.contact_person ?? "");
  const [phone, setPhone] = useState(row.phone ?? "");
  const address = row.address ?? "";
  const [agentType, setAgentType] = useState(row.kind === "agent" ? (row.agent_type ?? "") : "");
  const [commission, setCommission] = useState(
    row.kind === "agent" ? String(row.commission_pct ?? "") : "",
  );
  const [capacity, setCapacity] = useState(
    row.kind === "miller" ? String(row.capacity_kg_per_hr ?? "") : "",
  );
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
          ? {
              ...common,
              agent_type: agentType || null,
              commission_pct: commission ? parseFloat(commission) : 0,
            }
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
        <StatusDot active name={row.name} />
      </td>
      <td className="px-3 py-2">
        <input
          className="input !py-1 text-sm"
          value={name}
          data-testid="edit-name"
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td className="px-4 py-3">
        <TypeBadge kind={row.kind} />
      </td>
      <td className="px-3 py-2">
        <input
          className="input !py-1 text-sm"
          value={contact}
          placeholder="Contact person"
          onChange={(e) => setContact(e.target.value)}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className="input !py-1 text-sm"
          value={phone}
          placeholder="Phone"
          onChange={(e) => setPhone(e.target.value)}
        />
      </td>
      <td className="px-3 py-2">
        {row.kind === "agent" ? (
          <div className="flex items-center gap-1.5">
            <Select
              className="!py-1 text-sm !w-auto min-w-[10rem]"
              aria-label="Agent type"
              value={agentType}
              onChange={setAgentType}
              options={AGENT_TYPE_OPTIONS}
            />
            <input
              className="input !py-1 text-sm w-16"
              type="number"
              step="0.01"
              placeholder="%"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              className="input !py-1 text-sm w-20"
              type="number"
              step="0.01"
              placeholder="kg/hr"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <input
              className="input !py-1 text-sm w-20"
              type="number"
              step="0.0001"
              placeholder="₱/kg"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="badge-green">Active</span>
      </td>
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
  onClose,
  onSaved,
  setError,
}: {
  onClose: () => void;
  onSaved: () => void;
  setError: (msg: string | null) => void;
}) {
  useEscapeKey(onClose);
  const [kind, setKind] = useState<OperatorKind>("agent");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [agentType, setAgentType] = useState("");
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
          ? {
              ...common,
              agent_type: agentType || null,
              commission_pct: commission ? parseFloat(commission) : 0,
            }
          : {
              ...common,
              capacity_kg_per_hr: capacity ? parseFloat(capacity) : null,
              milling_fee_per_kg: fee ? parseFloat(fee) : null,
            };
      return dispatchService.createOperator(kind, body);
    },
    onSuccess: () => {
      onSaved();
    },
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
                kind === k
                  ? "bg-white dark:bg-slate-900 text-primary shadow-sm"
                  : "text-secondary hover:text-primary"
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
          <input
            className="input"
            data-testid="new-operator-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
              <label className={LABEL} htmlFor="new-operator-agent-type">
                Agent type
              </label>
              <Select
                id="new-operator-agent-type"
                value={agentType}
                onChange={setAgentType}
                options={AGENT_TYPE_OPTIONS}
              />
            </div>
            <div>
              <label className={LABEL}>Commission %</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={LABEL}>Capacity (kg/hr)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL}>Milling fee per kg (₱)</label>
              <input
                className="input"
                type="number"
                step="0.0001"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">
          Cancel
        </button>
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

// ─────────────────────────────── Suppliers panel ────────────────────────────

function SuppliersPanel({
  status,
  search,
  suppliers,
  canEdit,
}: {
  status: StatusTab;
  /** Name filter, used by the deactivated list. */
  search: string;
  suppliers: Supplier[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (status === "active") {
      return suppliers.filter((s) => s.is_active).sort((a, b) => a.name.localeCompare(b.name));
    }
    const inactive = suppliers.filter((s) => !s.is_active);
    const searched = search.trim()
      ? inactive.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
      : inactive;
    return searched.sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, status, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["suppliers-all"] });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      paddyService.setSupplierActive(id, is_active),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Action failed."),
  });

  const colSpan = status === "active" ? 9 : 8;
  const headers =
    status === "active"
      ? ["", "Name", "Type", "Municipality", "Province", "Phone", "Farmer ID", "Status", ""]
      : ["", "Name", "Type", "Municipality", "Province", "Phone", "Farmer ID", ""];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {status === "active" && canEdit && (
          <button
            onClick={() => {
              setEditing(null);
              setShowForm((s) => !s);
              setError(null);
            }}
            className="btn-primary ml-auto"
            data-testid="add-supplier"
          >
            <Plus size={16} /> Add supplier
          </button>
        )}
      </div>

      {error && (
        <div className="card !py-3 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 flex items-center gap-2 text-sm">
          <AlertCircle size={14} className="text-rose-600 dark:text-rose-400" />
          <span className="text-rose-900 dark:text-rose-100">{error}</span>
        </div>
      )}

      {(showForm || editing) && (
        <SupplierForm
          initial={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            invalidate();
            setShowForm(false);
            setEditing(null);
            setError(null);
          }}
          setError={setError}
        />
      )}

      <div className="card overflow-hidden p-0">
        <table
          className="w-full text-sm"
          data-testid={status === "active" ? "suppliers-table" : "deactivated-suppliers-table"}
        >
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-muted font-medium">
                  {status === "active"
                    ? `No active suppliers yet${canEdit ? ". Add one above." : "."}`
                    : search
                      ? "No deactivated suppliers match your search."
                      : "No deactivated suppliers."}
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <SupplierRow
                  key={s.id}
                  supplier={s}
                  status={status}
                  onEdit={() => {
                    setShowForm(false);
                    setEditing(s);
                    setError(null);
                  }}
                  onToggle={(is_active) => toggleActive.mutate({ id: s.id, is_active })}
                  canEdit={canEdit}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplierRow({
  supplier,
  status,
  onEdit,
  onToggle,
  canEdit,
}: {
  supplier: Supplier;
  status: StatusTab;
  onEdit: () => void;
  onToggle: (isActive: boolean) => void;
  canEdit: boolean;
}) {
  const deactivated = status === "deactivated";
  return (
    <tr
      className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${deactivated ? "opacity-70 hover:opacity-100 transition-opacity" : ""}`}
      data-testid={`supplier-row-${supplier.id}`}
    >
      <td className="px-4 py-3">
        <StatusDot active={!deactivated} name={supplier.name} />
      </td>
      <td className="px-4 py-3 font-semibold text-primary">{supplier.name}</td>
      <td className="px-4 py-3">
        <SupplierTypeBadge type={supplier.supplier_type} />
      </td>
      <td className="px-4 py-3 text-secondary">{supplier.municipality || "—"}</td>
      <td className="px-4 py-3 text-secondary">{supplier.province || "—"}</td>
      <td className="px-4 py-3 text-secondary">{supplier.phone || "—"}</td>
      <td className="px-4 py-3 text-secondary font-mono text-xs">{supplier.farmer_id || "—"}</td>
      {!deactivated && (
        <td className="px-4 py-3">
          <span className="badge-green">Active</span>
        </td>
      )}
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {canEdit && !deactivated && (
            <>
              <button
                type="button"
                onClick={onEdit}
                data-testid={`edit-supplier-${supplier.id}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                type="button"
                onClick={() => onToggle(false)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <Power size={12} /> Deactivate
              </button>
            </>
          )}
          {canEdit && deactivated && (
            <button
              type="button"
              onClick={() => onToggle(true)}
              data-testid={`reactivate-supplier-${supplier.id}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              <Power size={12} /> Activate
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function SupplierForm({
  initial,
  onClose,
  onSaved,
  setError,
}: {
  initial: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
  setError: (msg: string | null) => void;
}) {
  useEscapeKey(onClose);
  const [name, setName] = useState(initial?.name ?? "");
  const [supplierType, setSupplierType] = useState(initial?.supplier_type ?? "farmer");
  const [contact, setContact] = useState(initial?.contact_person ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [municipality, setMunicipality] = useState(initial?.municipality ?? "");
  const [province, setProvince] = useState(initial?.province ?? "");
  const [farmerId, setFarmerId] = useState(initial?.farmer_id ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        supplier_type: supplierType || null,
        contact_person: contact || null,
        phone: phone || null,
        municipality: municipality || null,
        province: province || null,
        farmer_id: farmerId || null,
        address: address || null,
      };
      return initial
        ? paddyService.updateSupplier(initial.id, body)
        : paddyService.createSupplier(body);
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Failed to save supplier."),
  });

  return (
    <div className="card space-y-4" data-testid="supplier-form">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-primary">
          {initial ? "Edit supplier" : "New supplier"}
        </h3>
        <button type="button" onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close">
          <XIcon size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Name *</label>
          <input
            className="input"
            data-testid="supplier-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Type</label>
          <select
            className="input"
            value={supplierType}
            onChange={(e) => setSupplierType(e.target.value)}
          >
            {SUPPLIER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL}>Contact person</label>
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Municipality</label>
          <input
            className="input"
            value={municipality}
            onChange={(e) => setMunicipality(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Province</label>
          <input className="input" value={province} onChange={(e) => setProvince(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Farmer ID (RSBSA / PhilSys)</label>
          <input className="input" value={farmerId} onChange={(e) => setFarmerId(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Address</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending}
          className="btn-primary"
          data-testid="save-supplier"
        >
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Save supplier"}
        </button>
      </div>
    </div>
  );
}
