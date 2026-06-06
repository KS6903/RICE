import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, HardHat, Plus, Pencil, Power, X as XIcon, Check,
  Package, Calendar, AlertCircle, CheckCircle2, UserCircle2, Factory,
} from "lucide-react";
import { dispatchService } from "../services/DispatchService";
import ColorSwatch from "../components/dispatch/ColorSwatch";
import CourierPicker, { CourierParty } from "../components/dispatch/CourierPicker";
import { useAccess } from "../hooks/useAccess";

type Tab = "delivery" | "operators";

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
};

type OperatorKind = "agent" | "miller";

/** A unified row that powers the Field Operators table — discriminated by `kind`. */
type OperatorRow =
  | ({ kind: "agent" } & Agent)
  | ({ kind: "miller" } & Miller);

type DispatchOrder = {
  id: string;
  order_no: string;
  order_date: string | null;
  delivery_date: string | null;
  status: string;
  total_amount: number | null;
  delivered_at: string | null;
  customer: { id: string; name: string } | null;
  assigned_agent: Agent | null;
  assigned_miller: Miller | null;
};

const LABEL = "block text-xs font-bold uppercase tracking-wider text-muted mb-1";

/** Tiny read-only badge that sits next to the color swatch to make clear the
 *  hex is system-managed and not user-editable. */
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

export default function DispatchPage() {
  const [tab, setTab] = useState<Tab>("delivery");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "delivery", label: "Order Delivery", icon: Truck },
    { key: "operators", label: "Field Operators", icon: HardHat },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <Truck size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Dispatch</h2>
          <p className="text-sm text-secondary">
            Assign couriers to orders and manage your field operators — agents and third-party millers — with a reserved color per contact.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              data-testid={`dispatch-tab-${key}`}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                active
                  ? "bg-grad-brand text-white shadow-grad-glow"
                  : "text-secondary hover:text-primary hover:bg-slate-100/60 dark:hover:bg-slate-700/30"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "delivery" && <DeliveryTab />}
      {tab === "operators" && <FieldOperatorsTab />}
    </div>
  );
}

/* ───────────────────── Delivery tab ───────────────────── */

function DeliveryTab() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [assigning, setAssigning] = useState<DispatchOrder | null>(null);

  const { data: orders = [], isLoading } = useQuery<DispatchOrder[]>({
    queryKey: ["dispatch-orders"],
    queryFn: () => dispatchService.listOrders(),
  });
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["dispatch-agents-active"],
    queryFn: () => dispatchService.listAgents(),
  });
  const { data: millers = [] } = useQuery<Miller[]>({
    queryKey: ["dispatch-millers-active"],
    queryFn: () => dispatchService.listMillers(),
  });

  const markDelivered = useMutation({
    mutationFn: (id: string) => dispatchService.markDelivered(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispatch-orders"] }),
  });

  if (isLoading) {
    return <div className="card text-sm text-secondary text-center py-10">Loading orders…</div>;
  }
  if (orders.length === 0) {
    return (
      <div className="card text-center py-12">
        <Package size={36} className="mx-auto text-muted mb-3" />
        <p className="text-secondary font-medium">No orders awaiting delivery.</p>
        <p className="text-xs text-muted mt-1">Confirmed sales orders show up here so you can assign a courier.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="dispatch-orders-table">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {["Order #", "Customer", "Courier", "Delivery date", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {orders.map((o) => {
                const courier = o.assigned_agent ?? o.assigned_miller;
                const courierKind = o.assigned_agent ? "Agent" : o.assigned_miller ? "Miller" : null;
                return (
                  <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-primary">{o.order_no}</td>
                    <td className="px-4 py-3 text-secondary">{o.customer?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {courier ? (
                        <span className="inline-flex items-center gap-1.5">
                          <ColorSwatch color={courier.canva_color_hex} label={courier.name} size={12} />
                          <span className="text-primary font-medium">{courier.name}</span>
                          <span className="text-[10px] font-semibold text-muted uppercase tracking-wide">
                            {courierKind}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      {o.delivery_date ? (
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={12} className="text-muted" />
                          {o.delivery_date}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!canEdit("dispatch") && (
                          <span className="text-xs text-muted">View only</span>
                        )}
                        {canEdit("dispatch") && (
                        <button
                          type="button"
                          data-testid={`assign-courier-${o.id}`}
                          onClick={() => setAssigning(o)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
                          title="Assign or change courier"
                        >
                          <Pencil size={12} /> Courier
                        </button>
                        )}
                        {canEdit("dispatch") && o.status !== "delivered" && (
                          <button
                            type="button"
                            data-testid={`mark-delivered-${o.id}`}
                            onClick={() => markDelivered.mutate(o.id)}
                            disabled={markDelivered.isPending}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                          >
                            <CheckCircle2 size={12} /> Mark delivered
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {assigning && (
        <AssignCourierModal
          order={assigning}
          agents={agents as CourierParty[]}
          millers={millers as CourierParty[]}
          onClose={() => setAssigning(null)}
        />
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    confirmed: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    delivered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    invoiced: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
    paid: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  };
  return (
    <span className={`text-xs font-bold capitalize px-2 py-0.5 rounded-md ${styles[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status}
    </span>
  );
}

function AssignCourierModal({
  order, agents, millers, onClose,
}: {
  order: DispatchOrder;
  agents: CourierParty[];
  millers: CourierParty[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const current = order.assigned_agent
    ? { kind: "agent" as const, id: order.assigned_agent.id }
    : order.assigned_miller
      ? { kind: "miller" as const, id: order.assigned_miller.id }
      : null;
  const [pick, setPick] = useState<{ kind: "agent" | "miller"; id: string } | null>(current);

  const assign = useMutation({
    mutationFn: (p: { kind: "agent" | "miller"; id: string } | null) =>
      dispatchService.assignCourier(order.id, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[460px] glass-strong rounded-2xl shadow-2xl ring-1 ring-soft p-5 animate-grad-fade-up" data-testid="assign-courier-modal">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-primary">Assign courier</h3>
            <p className="text-xs text-muted mt-0.5">Order <span className="font-mono">{order.order_no}</span> — {order.customer?.name ?? "no customer"}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="btn-ghost !p-1.5">
            <XIcon size={16} />
          </button>
        </div>

        <CourierPicker agents={agents} millers={millers} current={pick} onPick={setPick} />

        {assign.isError && (
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-3 flex items-center gap-1">
            <AlertCircle size={12} /> {(assign.error as any)?.response?.data?.detail ?? "Failed to assign courier."}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-soft">
          <button type="button" onClick={onClose} className="btn-secondary !py-1.5 !px-3 text-sm">Cancel</button>
          <button
            type="button"
            data-testid="confirm-courier"
            onClick={() => assign.mutate(pick)}
            disabled={assign.isPending}
            className="btn-primary !py-1.5 !px-3 text-sm disabled:opacity-50"
          >
            {assign.isPending ? "Saving…" : "Save courier"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── Field Operators tab ─────────────────────
   Combines Agents and Millers under one operational surface. The
   underlying tables stay separate (different schemas) — this tab
   just renders both as one list and routes create/update/toggle
   calls to the right endpoint per row. */

type Filter = "all" | "agent" | "miller";

function FieldOperatorsTab() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [filter, setFilter] = useState<Filter>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["dispatch-agents-all"],
    queryFn: () => dispatchService.listAgents(true),
  });
  const { data: millers = [] } = useQuery<Miller[]>({
    queryKey: ["dispatch-millers-all"],
    queryFn: () => dispatchService.listMillers(true),
  });

  const rows: OperatorRow[] = useMemo(() => {
    const all: OperatorRow[] = [
      ...agents.map((a): OperatorRow => ({ kind: "agent", ...a })),
      ...millers.map((m): OperatorRow => ({ kind: "miller", ...m })),
    ];
    const filtered = filter === "all" ? all : all.filter((r) => r.kind === filter);
    return filtered.sort((x, y) => x.name.localeCompare(y.name));
  }, [agents, millers, filter]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["dispatch-agents-all"] });
    qc.invalidateQueries({ queryKey: ["dispatch-agents-active"] });
    qc.invalidateQueries({ queryKey: ["dispatch-millers-all"] });
    qc.invalidateQueries({ queryKey: ["dispatch-millers-active"] });
  };

  const toggleActive = useMutation({
    mutationFn: ({ row, is_active }: { row: OperatorRow; is_active: boolean }) =>
      dispatchService.setOperatorActive(row.kind, row.id, is_active),
    onSuccess: invalidateAll,
  });

  const activeCount = rows.filter((r) => r.is_active).length;
  const agentCount = agents.length;
  const millerCount = millers.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 ring-1 ring-soft" role="tablist">
          {(["all", "agent", "miller"] as const).map((k) => {
            const count = k === "all" ? agents.length + millers.length : k === "agent" ? agentCount : millerCount;
            const label = k === "all" ? "All" : k === "agent" ? "Agents" : "Millers";
            const active = filter === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`operators-filter-${k}`}
                onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  active
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
        <p className="text-xs text-muted">
          {activeCount} active · system reserves a unique color per operator
        </p>
        {canEdit("dispatch") && (
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

      {error && (
        <div className="card !py-3 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 flex items-center gap-2 text-sm">
          <AlertCircle size={14} className="text-rose-600" />
          <span className="text-rose-900 dark:text-rose-100">{error}</span>
        </div>
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
            {rows.map((row) =>
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
                  onToggleActive={() => toggleActive.mutate({ row, is_active: !row.is_active })}
                />
              )
            )}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted font-medium">
                No {filter === "all" ? "field operators" : filter + "s"} yet — add one above.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TypeBadge({ kind }: { kind: OperatorKind }) {
  const Icon = kind === "agent" ? UserCircle2 : Factory;
  const style = kind === "agent"
    ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
    : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${style}`}
      data-testid={`type-badge-${kind}`}>
      <Icon size={10} />
      {kind === "agent" ? "Agent" : "Miller"}
    </span>
  );
}

function ViewOperatorRow({
  row, onEdit, onToggleActive,
}: {
  row: OperatorRow;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const details =
    row.kind === "agent"
      ? row.commission_pct ? `${row.commission_pct}% commission` : "—"
      : row.capacity_kg_per_hr ? `${row.capacity_kg_per_hr} kg/hr` : "—";
  return (
    <tr className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${!row.is_active ? "opacity-60" : ""}`}
      data-testid={`operator-row-${row.id}`}>
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
      <td className="px-4 py-3">
        {row.is_active
          ? <span className="badge-green">Active</span>
          : <span className="badge-red">Inactive</span>}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" onClick={onEdit}
            data-testid={`edit-operator-${row.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40">
            <Pencil size={12} /> Edit
          </button>
          <button type="button" onClick={onToggleActive}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold ${
              row.is_active
                ? "text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            }`}>
            <Power size={12} />
            {row.is_active ? "Deactivate" : "Activate"}
          </button>
        </div>
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
  // Local edit-buffer keyed off the row's fields so cancel reverts cleanly.
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
      const body = row.kind === "agent"
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
      <td className="px-3 py-2"><input className="input !py-1 text-sm" value={name} data-testid="edit-name" onChange={(e) => setName(e.target.value)} /></td>
      <td className="px-4 py-3"><TypeBadge kind={row.kind} /></td>
      <td className="px-3 py-2"><input className="input !py-1 text-sm" value={contact} placeholder="Contact person" onChange={(e) => setContact(e.target.value)} /></td>
      <td className="px-3 py-2"><input className="input !py-1 text-sm" value={phone} placeholder="Phone" onChange={(e) => setPhone(e.target.value)} /></td>
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
      <td className="px-4 py-3">
        {row.is_active
          ? <span className="badge-green">Active</span>
          : <span className="badge-red">Inactive</span>}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}
            data-testid={`save-operator-${row.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50">
            <Check size={12} /> {save.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onCancel}
            data-testid={`cancel-operator-${row.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40">
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
      const body = kind === "agent"
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
        <button type="button" onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close"><XIcon size={16} /></button>
      </div>

      {/* Type picker — segmented control */}
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
        <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} className="btn-primary"
          data-testid="save-new-operator">
          {create.isPending ? "Saving…" : "Save operator"}
        </button>
      </div>
    </div>
  );
}
