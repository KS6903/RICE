import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck,
  Pencil,
  Package,
  Calendar,
  AlertCircle,
  CheckCircle2,
  X as XIcon,
  Plus,
  Fuel,
  ClipboardList,
  Car,
  Check,
} from "lucide-react";
import { format } from "date-fns";
import { dispatchService } from "../services/DispatchService";
import { fleetService, TRUCK_TYPES } from "../services/FleetService";
import type { Driver, Truck as TruckType, DispatchTrip } from "../services/FleetService";
import { employeesService } from "../services/EmployeesService";
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

type PageTab = "orders" | "trips" | "fleet";
type FleetTab = "trucks" | "drivers";

const LABEL = "block text-xs font-bold uppercase tracking-wider text-muted mb-1";

export default function DispatchPage() {
  const [tab, setTab] = useState<PageTab>("orders");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-grad-brand grid place-items-center shadow-grad-glow">
          <Truck size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Dispatch</h2>
          <p className="text-sm text-secondary">
            Assign couriers, log trips, and manage your fleet.
          </p>
        </div>
      </div>

      {/* outer tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto">
        {(
          [
            { key: "orders" as PageTab, label: "Orders", icon: ClipboardList },
            { key: "trips" as PageTab, label: "Trips", icon: Fuel },
            { key: "fleet" as PageTab, label: "Fleet", icon: Car },
          ] as const
        ).map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                active
                  ? "bg-grad-brand text-white shadow-grad-glow"
                  : "text-secondary hover:text-primary hover:bg-slate-100/60 dark:hover:bg-slate-700/30"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "orders" && <OrdersTab />}
      {tab === "trips" && <TripsTab />}
      {tab === "fleet" && <FleetTab />}
    </div>
  );
}

// ─────────────────────────────── Orders tab ────────────────────────────────

function OrdersTab() {
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

  if (isLoading)
    return <div className="card text-sm text-secondary text-center py-10">Loading orders…</div>;
  if (orders.length === 0) {
    return (
      <div className="card text-center py-12">
        <Package size={36} className="mx-auto text-muted mb-3" />
        <p className="text-secondary font-medium">No orders awaiting delivery.</p>
        <p className="text-xs text-muted mt-1">
          Confirmed sales orders show up here so you can assign a courier.
        </p>
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
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {orders.map((o) => {
                const courier = o.assigned_agent ?? o.assigned_miller;
                const courierKind = o.assigned_agent
                  ? "Agent"
                  : o.assigned_miller
                    ? "Miller"
                    : null;
                return (
                  <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-primary">{o.order_no}</td>
                    <td className="px-4 py-3 text-secondary">{o.customer?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {courier ? (
                        <span className="inline-flex items-center gap-1.5">
                          <ColorSwatch
                            color={courier.canva_color_hex}
                            label={courier.name}
                            size={12}
                          />
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
                      ) : (
                        "—"
                      )}
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
    planned: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    in_transit: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    cancelled: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
  };
  return (
    <span
      className={`text-xs font-bold capitalize px-2 py-0.5 rounded-md ${styles[status] ?? "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function AssignCourierModal({
  order,
  agents,
  millers,
  onClose,
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
    mutationFn: (p: typeof pick) => dispatchService.assignCourier(order.id, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[460px] glass-strong rounded-2xl shadow-2xl ring-1 ring-soft p-5 animate-grad-fade-up"
        data-testid="assign-courier-modal"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-primary">Assign courier</h3>
            <p className="text-xs text-muted mt-0.5">
              Order <span className="font-mono">{order.order_no}</span> —{" "}
              {order.customer?.name ?? "no customer"}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="btn-ghost !p-1.5">
            <XIcon size={16} />
          </button>
        </div>
        <CourierPicker agents={agents} millers={millers} current={pick} onPick={setPick} />
        {assign.isError && (
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-3 flex items-center gap-1">
            <AlertCircle size={12} />{" "}
            {(assign.error as any)?.response?.data?.detail ?? "Failed to assign courier."}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-soft">
          <button type="button" onClick={onClose} className="btn-secondary !py-1.5 !px-3 text-sm">
            Cancel
          </button>
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

// ─────────────────────────────── Trips tab ─────────────────────────────────

function TripsTab() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DispatchTrip | null>(null);

  const { data: trips = [] } = useQuery<DispatchTrip[]>({
    queryKey: ["dispatch-trips"],
    queryFn: () => fleetService.listTrips(),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fleetService.updateTrip(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispatch-trips"] }),
  });

  return (
    <div className="space-y-4">
      {canEdit("dispatch") && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setEditing(null);
              setShowForm((s) => !s);
            }}
            className="btn-primary"
            data-testid="new-dispatch-btn"
          >
            <Plus size={16} /> New Dispatch
          </button>
        </div>
      )}

      {(showForm || editing) && (
        <TripForm
          initial={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["dispatch-trips"] });
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {trips.length === 0 && !showForm ? (
        <div className="card text-center py-12">
          <Fuel size={36} className="mx-auto text-muted mb-3" />
          <p className="text-secondary font-medium">No dispatch trips yet.</p>
          <p className="text-xs text-muted mt-1">
            Create a trip to log truck, driver, and fuel details.
          </p>
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {[
                  "Trip #",
                  "Date",
                  "Truck",
                  "Driver",
                  "Fuel (L)",
                  "Order",
                  "Destination",
                  "Status",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {trips.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono text-xs text-primary">{t.trip_no}</td>
                  <td className="px-4 py-3 text-secondary">{t.dispatch_date}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-primary">{t.truck_plate ?? "—"}</span>
                    {t.truck_type && (
                      <span className="ml-1 text-[10px] text-muted uppercase">
                        {t.truck_type.replace("_", " ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-secondary">{t.driver_name ?? "—"}</td>
                  <td className="px-4 py-3 text-secondary tabular-nums">{t.fuel_used_l ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-secondary">
                    {t.order_no ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-secondary">{t.destination ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit("dispatch") && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowForm(false);
                            setEditing(t);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        {t.status === "planned" && (
                          <button
                            type="button"
                            onClick={() => updateStatus.mutate({ id: t.id, status: "in_transit" })}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/30"
                          >
                            <Truck size={12} /> Depart
                          </button>
                        )}
                        {t.status === "in_transit" && (
                          <button
                            type="button"
                            onClick={() => updateStatus.mutate({ id: t.id, status: "completed" })}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                          >
                            <Check size={12} /> Complete
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TripForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: DispatchTrip | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: trucks = [] } = useQuery<TruckType[]>({
    queryKey: ["fleet-trucks"],
    queryFn: () => fleetService.listTrucks(),
  });
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["fleet-drivers"],
    queryFn: () => fleetService.listDrivers(),
  });
  const { data: orders = [] } = useQuery<DispatchOrder[]>({
    queryKey: ["dispatch-orders"],
    queryFn: () => dispatchService.listOrders(),
  });

  const [truckId, setTruckId] = useState(initial?.truck_id ?? "");
  const [driverId, setDriverId] = useState(initial?.driver_id ?? "");
  const [date, setDate] = useState(initial?.dispatch_date ?? format(new Date(), "yyyy-MM-dd"));
  const [fuelUsed, setFuelUsed] = useState(
    initial?.fuel_used_l != null ? String(initial.fuel_used_l) : "",
  );
  const [orderId, setOrderId] = useState(initial?.order_id ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const handleTruckChange = (id: string) => {
    setTruckId(id);
    const truck = trucks.find((t) => t.id === id);
    if (truck?.default_driver_id && !driverId) {
      setDriverId(truck.default_driver_id);
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        truck_id: truckId,
        driver_id: driverId,
        dispatch_date: date,
        fuel_used_l: fuelUsed ? parseFloat(fuelUsed) : null,
        order_id: orderId || null,
        destination: destination || null,
        notes: notes || null,
      };
      return initial ? fleetService.updateTrip(initial.id, body) : fleetService.createTrip(body);
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Failed to save trip."),
  });

  return (
    <div className="card space-y-4" data-testid="trip-form">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-primary">{initial ? "Edit trip" : "New dispatch"}</h3>
        <button type="button" onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close">
          <XIcon size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Truck *</label>
          <select
            className="input"
            value={truckId}
            onChange={(e) => handleTruckChange(e.target.value)}
          >
            <option value="">Select truck…</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate_number}
                {t.truck_type ? ` — ${t.truck_type.replace("_", " ")}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL}>Driver *</label>
          <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Select driver…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.is_payroll ? " (payroll)" : ""}
              </option>
            ))}
          </select>
          {truckId && trucks.find((t) => t.id === truckId)?.default_driver_name && (
            <p className="text-[10px] text-muted mt-1">
              Default: {trucks.find((t) => t.id === truckId)?.default_driver_name}
              {driverId !== trucks.find((t) => t.id === truckId)?.default_driver_id && driverId && (
                <span className="text-amber-600 dark:text-amber-400 ml-1">(overridden)</span>
              )}
            </p>
          )}
        </div>
        <div>
          <label className={LABEL}>Dispatch date *</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Fuel used (L)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            placeholder="e.g. 12.5"
            value={fuelUsed}
            onChange={(e) => setFuelUsed(e.target.value)}
          />
          {truckId && trucks.find((t) => t.id === truckId)?.fuel_consumption_l_per_100km && (
            <p className="text-[10px] text-muted mt-1">
              This truck: {trucks.find((t) => t.id === truckId)?.fuel_consumption_l_per_100km} L/100
              km
            </p>
          )}
        </div>
        <div>
          <label className={LABEL}>Linked order</label>
          <select className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">None</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_no}
                {o.customer ? ` — ${o.customer.name}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL}>Destination</label>
          <input
            className="input"
            placeholder="e.g. Bayambang, Pangasinan"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={!truckId || !driverId || !date || save.isPending}
          className="btn-primary"
        >
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Create dispatch"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────── Fleet tab ─────────────────────────────────

function FleetTab() {
  const [sub, setSub] = useState<FleetTab>("trucks");
  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 ring-1 ring-soft">
        {(["trucks", "drivers"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSub(k)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${
              sub === k
                ? "bg-white dark:bg-slate-900 text-primary shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      {sub === "trucks" && <TrucksPanel />}
      {sub === "drivers" && <DriversPanel />}
    </div>
  );
}

// ── Trucks panel ─────────────────────────────────────────────────────────────

function TrucksPanel() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TruckType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: trucks = [] } = useQuery<TruckType[]>({
    queryKey: ["fleet-trucks"],
    queryFn: () => fleetService.listTrucks(true),
  });
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["fleet-drivers"],
    queryFn: () => fleetService.listDrivers(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["fleet-trucks"] });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      fleetService.updateTruck(id, { is_active }),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Failed."),
  });

  return (
    <div className="space-y-4">
      {error && (
        <div className="card !py-3 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 flex items-center gap-2 text-sm">
          <AlertCircle size={14} className="text-rose-600 dark:text-rose-400" />
          <span className="text-rose-900 dark:text-rose-100">{error}</span>
        </div>
      )}
      {canEdit("dispatch") && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setEditing(null);
              setShowForm((s) => !s);
              setError(null);
            }}
            className="btn-primary"
            data-testid="add-truck-btn"
          >
            <Plus size={16} /> Add truck
          </button>
        </div>
      )}
      {(showForm || editing) && (
        <TruckForm
          initial={editing}
          drivers={drivers}
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
      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {[
                "Plate",
                "Type",
                "Fuel rate (L/100km)",
                "Default driver",
                "Notes",
                "Status",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {trucks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No trucks yet{canEdit("dispatch") ? " — add one above." : "."}
                </td>
              </tr>
            ) : (
              trucks.map((t) => (
                <tr
                  key={t.id}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${!t.is_active ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 font-mono font-bold text-primary">{t.plate_number}</td>
                  <td className="px-4 py-3 capitalize text-secondary">
                    {t.truck_type?.replace("_", " ") ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-secondary">
                    {t.fuel_consumption_l_per_100km ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-secondary">
                    {t.default_driver_name ?? <span className="text-muted italic">None</span>}
                  </td>
                  <td className="px-4 py-3 text-secondary text-xs">{t.notes ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-md ${t.is_active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-slate-100 text-slate-600"}`}
                    >
                      {t.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit("dispatch") && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowForm(false);
                            setEditing(t);
                            setError(null);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle.mutate({ id: t.id, is_active: !t.is_active })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        >
                          {t.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TruckForm({
  initial,
  drivers,
  onClose,
  onSaved,
  setError,
}: {
  initial: TruckType | null;
  drivers: Driver[];
  onClose: () => void;
  onSaved: () => void;
  setError: (m: string | null) => void;
}) {
  const [plate, setPlate] = useState(initial?.plate_number ?? "");
  const [type, setType] = useState(initial?.truck_type ?? "");
  const [fuelRate, setFuelRate] = useState(
    initial?.fuel_consumption_l_per_100km != null
      ? String(initial.fuel_consumption_l_per_100km)
      : "",
  );
  const [defaultDriverId, setDefaultDriverId] = useState(initial?.default_driver_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        plate_number: plate.trim(),
        truck_type: type || null,
        fuel_consumption_l_per_100km: fuelRate ? parseFloat(fuelRate) : null,
        default_driver_id: defaultDriverId || null,
        notes: notes || null,
      };
      return initial ? fleetService.updateTruck(initial.id, body) : fleetService.createTruck(body);
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Failed to save truck."),
  });

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-primary">{initial ? "Edit truck" : "Add truck"}</h3>
        <button type="button" onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close">
          <XIcon size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Plate number *</label>
          <input
            className="input"
            placeholder="e.g. ABC 1234"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Truck type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">— select —</option>
            {TRUCK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL}>Fuel consumption (L/100 km)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            placeholder="e.g. 12"
            value={fuelRate}
            onChange={(e) => setFuelRate(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Default driver</label>
          <select
            className="input"
            value={defaultDriverId}
            onChange={(e) => setDefaultDriverId(e.target.value)}
          >
            <option value="">— none —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={!plate.trim() || save.isPending}
          className="btn-primary"
        >
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Add truck"}
        </button>
      </div>
    </div>
  );
}

// ── Drivers panel ─────────────────────────────────────────────────────────────

function DriversPanel() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["fleet-drivers-all"],
    queryFn: () => fleetService.listDrivers(true),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fleet-drivers"] });
    qc.invalidateQueries({ queryKey: ["fleet-drivers-all"] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      fleetService.updateDriver(id, { is_active }),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Failed."),
  });

  return (
    <div className="space-y-4">
      {error && (
        <div className="card !py-3 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 flex items-center gap-2 text-sm">
          <AlertCircle size={14} className="text-rose-600 dark:text-rose-400" />
          <span className="text-rose-900 dark:text-rose-100">{error}</span>
        </div>
      )}
      {canEdit("dispatch") && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setEditing(null);
              setShowForm((s) => !s);
              setError(null);
            }}
            className="btn-primary"
            data-testid="add-driver-btn"
          >
            <Plus size={16} /> Add driver
          </button>
        </div>
      )}
      {(showForm || editing) && (
        <DriverForm
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
      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {["Name", "Phone", "License", "Type", "Employee link", "Status", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {drivers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No drivers yet{canEdit("dispatch") ? " — add one above." : "."}
                </td>
              </tr>
            ) : (
              drivers.map((d) => (
                <tr
                  key={d.id}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${!d.is_active ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 font-semibold text-primary">{d.name}</td>
                  <td className="px-4 py-3 text-secondary">{d.phone ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-secondary">
                    {d.license_no ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${d.is_payroll ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
                    >
                      {d.is_payroll ? "Payroll" : "Independent"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-secondary text-xs">
                    {d.is_payroll ? (
                      (d.employee_name ?? (
                        <span className="text-amber-600 dark:text-amber-400">Not linked</span>
                      ))
                    ) : (
                      <span className="text-muted italic">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-md ${d.is_active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-slate-100 text-slate-600"}`}
                    >
                      {d.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit("dispatch") && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowForm(false);
                            setEditing(d);
                            setError(null);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-secondary hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700/40"
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle.mutate({ id: d.id, is_active: !d.is_active })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        >
                          {d.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DriverForm({
  initial,
  onClose,
  onSaved,
  setError,
}: {
  initial: Driver | null;
  onClose: () => void;
  onSaved: () => void;
  setError: (m: string | null) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [licenseNo, setLicenseNo] = useState(initial?.license_no ?? "");
  const [isPayroll, setIsPayroll] = useState(initial?.is_payroll ?? false);
  const [employeeId, setEmployeeId] = useState(initial?.employee_id ?? "");

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ["employees"],
    queryFn: () => employeesService.list(),
    enabled: isPayroll,
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        phone: phone || null,
        license_no: licenseNo || null,
        is_payroll: isPayroll,
        employee_id: isPayroll && employeeId ? employeeId : null,
      };
      return initial
        ? fleetService.updateDriver(initial.id, body)
        : fleetService.createDriver(body);
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => setError(e?.response?.data?.detail ?? "Failed to save driver."),
  });

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-primary">{initial ? "Edit driver" : "Add driver"}</h3>
        <button type="button" onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close">
          <XIcon size={16} />
        </button>
      </div>

      {/* payroll toggle */}
      <div>
        <label className={LABEL}>Employment type</label>
        <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60 ring-1 ring-soft">
          {(
            [
              { val: false, label: "Independent" },
              { val: true, label: "On payroll" },
            ] as const
          ).map(({ val, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setIsPayroll(val)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                isPayroll === val
                  ? "bg-white dark:bg-slate-900 text-primary shadow-sm"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>License no.</label>
          <input
            className="input"
            placeholder="e.g. PH-DL-12345"
            value={licenseNo}
            onChange={(e) => setLicenseNo(e.target.value)}
          />
        </div>
        {isPayroll && (
          <div>
            <label className={LABEL}>Link to employee</label>
            <select
              className="input"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">— search employees —</option>
              {employees.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted mt-1">
              Optional — links payroll records to this driver.
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending}
          className="btn-primary"
        >
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Add driver"}
        </button>
      </div>
    </div>
  );
}
