import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, Pencil, Package, Calendar, AlertCircle, CheckCircle2, X as XIcon,
} from "lucide-react";
import { dispatchService } from "../services/DispatchService";
import ColorSwatch from "../components/dispatch/ColorSwatch";
import CourierPicker, { CourierParty } from "../components/dispatch/CourierPicker";
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

export default function DispatchPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <Truck size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Dispatch</h2>
          <p className="text-sm text-secondary">
            Assign couriers to confirmed orders and mark deliveries.
          </p>
        </div>
      </div>
      <DeliveryTab />
    </div>
  );
}

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
