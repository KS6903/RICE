import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "../hooks/useEscapeKey";
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
  User,
  Undo2,
  Lock,
} from "lucide-react";
import { format } from "date-fns";
import { dispatchService } from "../services/DispatchService";
import { fleetService, TRUCK_TYPES } from "../services/FleetService";
import type { Driver, Truck as TruckType, DispatchTrip } from "../services/FleetService";
import { employeesService } from "../services/EmployeesService";
import { useFeature } from "../hooks/useFeature";
import Select from "../components/Select";
import ComboInput from "../components/ComboInput";
import DatePicker from "../components/DatePicker";
import { useAuthStore } from "../stores/authStore";
import { useAccess } from "../hooks/useAccess";
import CodeValue from "../components/CodeValue";

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
  // Who delivers it: the customer, or the rice mill's own courier.
  courier_type: "customer" | "mill" | null;
  // The vehicle and the driver that take it.
  courier_plate: string | null;
  courier_driver: string | null;
  courier_phone: string | null;
  courier_notes: string | null;
  // Until when the owner can still take the delivered mark off.
  unmark_until: string | null;
  assigned_agent: Agent | null;
  assigned_miller: Miller | null;
};

const COURIER_LABEL = { customer: "Customer", mill: "Rice mill courier" } as const;
const pastDeadline = (iso: string | null | undefined) => !!iso && Date.now() > Date.parse(iso);

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
      <div className="tab-strip flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto">
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
  // Only the owner can take a delivered mark back (and only for a week).
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";

  const markDelivered = useMutation({
    mutationFn: (id: string) => dispatchService.markDelivered(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispatch-orders"] }),
    // The list can be stale (a courier removed elsewhere): refresh it as well.
    onError: () => qc.invalidateQueries({ queryKey: ["dispatch-orders"] }),
  });
  const unmarkDelivered = useMutation({
    mutationFn: (id: string) => dispatchService.unmarkDelivered(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispatch-orders"] }),
    onError: () => qc.invalidateQueries({ queryKey: ["dispatch-orders"] }),
  });
  const detail = (e: unknown, fallback: string) =>
    ((e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail as
      string | undefined) ?? fallback;
  const deliverError = markDelivered.isError
    ? detail(markDelivered.error, "Couldn't mark the order delivered. Try again.")
    : unmarkDelivered.isError
      ? detail(unmarkDelivered.error, "Couldn't take the delivery back. Try again.")
      : null;

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
      {deliverError && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-900 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-100 dark:ring-rose-800/60"
        >
          <AlertCircle size={14} className="shrink-0 text-rose-600 dark:text-rose-400" />
          {deliverError}
        </div>
      )}
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
                const courier = o.courier_type;
                const legacyName = o.assigned_agent?.name ?? o.assigned_miller?.name ?? null;
                const canUndo = isOwner && o.status === "delivered";
                const undoOpen = canUndo && !!o.unmark_until && !pastDeadline(o.unmark_until);
                return (
                  <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-primary">{o.order_no}</td>
                    <td className="px-4 py-3 text-secondary">{o.customer?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {courier ? (
                        <div className="min-w-0">
                          <span className="inline-flex items-center gap-1.5">
                            {courier === "customer" ? (
                              <User size={12} className="text-muted" />
                            ) : (
                              <Truck size={12} className="text-muted" />
                            )}
                            <span className="text-primary font-medium">
                              {COURIER_LABEL[courier]}
                            </span>
                          </span>
                          {o.courier_plate && (
                            <p className="mt-0.5 text-xs text-secondary">
                              <span className="font-mono font-semibold text-primary">
                                {o.courier_plate}
                              </span>
                              {o.courier_driver && `, ${o.courier_driver}`}
                              {o.courier_phone && `, ${o.courier_phone}`}
                            </p>
                          )}
                          {(o.courier_notes || (!o.courier_plate && legacyName)) && (
                            <p
                              className="mt-0.5 max-w-[16rem] truncate text-xs text-muted"
                              title={o.courier_notes ?? legacyName ?? undefined}
                            >
                              {o.courier_notes ?? legacyName}
                            </p>
                          )}
                          {!o.courier_plate && o.status !== "delivered" && (
                            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                              No plate number yet
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted italic">Not chosen</span>
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
                            // Nothing is delivered until someone is assigned to deliver it.
                            disabled={markDelivered.isPending || !courier}
                            title={courier ? undefined : "Choose who delivers it first"}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                          >
                            <CheckCircle2 size={12} /> Mark delivered
                          </button>
                        )}
                        {undoOpen && (
                          <button
                            type="button"
                            data-testid={`unmark-delivered-${o.id}`}
                            onClick={() => unmarkDelivered.mutate(o.id)}
                            disabled={unmarkDelivered.isPending}
                            title="Take the delivered mark off. Possible for 7 days."
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50"
                          >
                            <Undo2 size={12} /> Unmark delivered
                          </button>
                        )}
                        {canUndo && !undoOpen && (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-muted"
                            title="Marked delivered more than 7 days ago, so it can no longer be changed."
                          >
                            <Lock size={11} /> Locked
                          </span>
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
      {assigning && <AssignCourierModal order={assigning} onClose={() => setAssigning(null)} />}
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

const COURIER_OPTIONS = [
  {
    value: "customer",
    label: "Customer",
    hint: "The customer collects it, or sends their own vehicle.",
    icon: User,
  },
  {
    value: "mill",
    label: "Rice mill courier",
    hint: "The mill delivers it with one of its own trucks.",
    icon: Truck,
  },
] as const;

function AssignCourierModal({ order, onClose }: { order: DispatchOrder; onClose: () => void }) {
  useEscapeKey(onClose);
  const qc = useQueryClient();
  const [choice, setChoice] = useState<"customer" | "mill" | null>(order.courier_type);
  const [plate, setPlate] = useState(order.courier_plate ?? "");
  const [driver, setDriver] = useState(order.courier_driver ?? "");
  const [phone, setPhone] = useState(order.courier_phone ?? "");
  const [notes, setNotes] = useState(order.courier_notes ?? "");

  // The mill's own trucks and drivers, to pick from instead of typing.
  const { data: trucks = [] } = useQuery<TruckType[]>({
    queryKey: ["fleet-trucks"],
    queryFn: () => fleetService.listTrucks(),
  });
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["fleet-drivers"],
    queryFn: () => fleetService.listDrivers(),
  });
  const takeDriver = (name: string) => {
    setDriver(name);
    const known = drivers.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
    if (known?.phone) setPhone(known.phone);
  };
  const takeTruck = (t: TruckType) => {
    setPlate(t.plate_number);
    if (t.default_driver_name) takeDriver(t.default_driver_name);
  };

  const ready = !!choice && !!plate.trim() && !!driver.trim();
  const assign = useMutation({
    mutationFn: (c: { choice: "customer" | "mill" | null }) =>
      dispatchService.assignCourier(order.id, c.choice, {
        plate_number: plate,
        driver_name: driver,
        driver_phone: phone,
        notes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      onClose();
    },
  });

  return createPortal(
    <div
      className="dialog-viewport fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-courier-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="dialog-panel relative w-full max-w-[460px] overflow-y-auto glass-strong rounded-2xl shadow-2xl ring-1 ring-soft p-5 animate-grad-fade-up"
        data-testid="assign-courier-modal"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 id="assign-courier-title" className="text-lg font-bold text-primary">
              Who delivers it
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Order <span className="font-mono">{order.order_no}</span>,{" "}
              {order.customer?.name ?? "no customer"}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="btn-ghost !p-1.5">
            <XIcon size={16} />
          </button>
        </div>

        <div role="radiogroup" aria-label="Courier" className="grid grid-cols-1 gap-2">
          {COURIER_OPTIONS.map(({ value, label, hint, icon: Icon }) => {
            const on = choice === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`courier-${value}`}
                onClick={() => setChoice(value)}
                className={`flex items-start gap-3 rounded-xl px-3.5 py-3 text-left ring-1 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  on
                    ? "bg-emerald-500/10 ring-emerald-400 shadow-sm"
                    : "ring-soft hover:ring-emerald-300 hover:bg-slate-50/60 dark:hover:bg-slate-700/30"
                }`}
              >
                <Icon
                  size={18}
                  className={`mt-0.5 shrink-0 ${on ? "text-emerald-600 dark:text-emerald-400" : "text-muted"}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary">{label}</span>
                  <span className="block text-xs text-muted mt-0.5">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {choice && (
          <div className="mt-4 space-y-3" data-testid="courier-details">
            {choice === "mill" && trucks.length > 0 && (
              <div>
                <p className={LABEL}>Pick a truck</p>
                <div className="flex flex-wrap gap-1.5">
                  {trucks.map((t) => {
                    const on = plate.trim().toUpperCase() === t.plate_number.toUpperCase();
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => takeTruck(t)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors ${
                          on
                            ? "bg-emerald-500/10 text-emerald-800 ring-emerald-400 dark:text-emerald-200"
                            : "text-secondary ring-soft hover:ring-emerald-300"
                        }`}
                      >
                        <span className="font-mono">{t.plate_number}</span>
                        {t.default_driver_name && (
                          <span className="font-normal text-muted">, {t.default_driver_name}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="courier-plate" className={LABEL}>
                  Plate number *
                </label>
                <ComboInput
                  id="courier-plate"
                  className="input font-mono uppercase"
                  maxLength={20}
                  placeholder="ABC 1234"
                  value={plate}
                  onChange={(v) => setPlate(v.toUpperCase())}
                  suggestions={choice === "mill" ? trucks.map((t) => t.plate_number) : []}
                />
              </div>
              <div>
                <label htmlFor="courier-driver" className={LABEL}>
                  Driver's name *
                </label>
                <ComboInput
                  id="courier-driver"
                  className="input"
                  maxLength={150}
                  placeholder={choice === "customer" ? "Who picks it up" : "Who drives"}
                  value={driver}
                  onChange={takeDriver}
                  suggestions={choice === "mill" ? drivers.map((d) => d.name) : []}
                />
              </div>
              <div>
                <label htmlFor="courier-phone" className={LABEL}>
                  Driver's phone
                </label>
                <input
                  id="courier-phone"
                  type="tel"
                  inputMode="tel"
                  maxLength={20}
                  className="input"
                  placeholder="0917 123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="courier-notes" className={LABEL}>
                Notes (optional)
              </label>
              <textarea
                id="courier-notes"
                rows={2}
                maxLength={500}
                className="input"
                placeholder="For example, the pickup time or the vehicle"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        {assign.isError && (
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-3 flex items-center gap-1">
            <AlertCircle size={12} />{" "}
            {(assign.error as any)?.response?.data?.detail ?? "Couldn't save who delivers it."}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-soft">
          <div>
            {order.courier_type && order.status !== "delivered" && (
              <button
                type="button"
                onClick={() => assign.mutate({ choice: null })}
                disabled={assign.isPending}
                className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary !py-1.5 !px-3 text-sm">
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-courier"
              onClick={() => assign.mutate({ choice })}
              disabled={assign.isPending || !ready}
              title={ready || !choice ? undefined : "Enter the plate number and the driver's name"}
              className="btn-primary !py-1.5 !px-3 text-sm disabled:opacity-50"
            >
              {assign.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
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

  // Only the owner can move a trip back from departed or delivered (and only for a week).
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fleetService.updateTrip(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispatch-trips"] }),
    onError: () => qc.invalidateQueries({ queryKey: ["dispatch-trips"] }),
  });
  const statusError = updateStatus.isError
    ? (((updateStatus.error as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail as string | undefined) ?? "Couldn't change the trip. Try again.")
    : null;

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

      {statusError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-900 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-100 dark:ring-rose-800/60"
        >
          <AlertCircle size={14} className="shrink-0 text-rose-600 dark:text-rose-400" />
          {statusError}
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
              {trips.map((t) => {
                const locked = pastDeadline(t.edit_until);
                return (
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
                    <td className="px-4 py-3 text-secondary tabular-nums">
                      {t.fuel_used_l ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      <CodeValue value={t.order_no} />
                    </td>
                    <td className="px-4 py-3 text-secondary">{t.destination ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit("dispatch") && locked && (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-muted"
                          title="This trip left or arrived more than 7 days ago, so it can no longer be edited."
                        >
                          <Lock size={11} /> Locked
                        </span>
                      )}
                      {canEdit("dispatch") && !locked && (
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
                              onClick={() =>
                                updateStatus.mutate({ id: t.id, status: "in_transit" })
                              }
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
                          {isOwner && t.status === "in_transit" && (
                            <button
                              type="button"
                              onClick={() => updateStatus.mutate({ id: t.id, status: "planned" })}
                              title="Take the departed mark off. Possible for 7 days."
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                            >
                              <Undo2 size={12} /> Undo depart
                            </button>
                          )}
                          {isOwner && t.status === "completed" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateStatus.mutate({ id: t.id, status: "in_transit" })
                              }
                              title="Take the delivered mark off. Possible for 7 days."
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                            >
                              <Undo2 size={12} /> Undo delivered
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
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
  useEscapeKey(onClose);
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
  // The trip number can be changed by the owner, on an existing trip.
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const [tripNo, setTripNo] = useState(initial?.trip_no ?? "");
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
      if (initial && isOwner && tripNo.trim() && tripNo.trim() !== initial.trip_no) {
        body.trip_no = tripNo.trim();
      }
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
        {initial && (
          <div className="sm:col-span-2">
            <label htmlFor="trip-no" className={LABEL}>
              Trip number
            </label>
            <input
              id="trip-no"
              className="input max-w-xs font-mono"
              value={tripNo}
              maxLength={30}
              disabled={!isOwner}
              onChange={(e) => setTripNo(e.target.value)}
            />
            {!isOwner && (
              <p className="text-[10px] text-muted mt-1">Only the owner can change the number.</p>
            )}
          </div>
        )}
        <div>
          <label className={LABEL}>Truck *</label>
          <Select
            aria-label="Truck"
            placeholder="Select truck…"
            value={truckId}
            onChange={handleTruckChange}
            options={trucks.map((t) => ({
              value: t.id,
              label: `${t.plate_number}${t.truck_type ? ` (${t.truck_type.replace("_", " ")})` : ""}`,
            }))}
          />
        </div>
        <div>
          <label className={LABEL}>Driver *</label>
          <Select
            aria-label="Driver"
            placeholder="Select driver…"
            value={driverId}
            onChange={setDriverId}
            options={drivers.map((d) => ({
              value: d.id,
              label: `${d.name}${d.is_payroll ? " (payroll)" : ""}`,
            }))}
          />
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
          <DatePicker aria-label="Dispatch date" value={date} onChange={setDate} />
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
          <Select
            aria-label="Linked order"
            value={orderId}
            onChange={setOrderId}
            options={[
              { value: "", label: "None" },
              ...orders.map((o) => ({
                value: o.id,
                label: `${o.order_no}${o.customer ? `, ${o.customer.name}` : ""}`,
              })),
            ]}
          />
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

/** The mill's trucks (also on Stock > Catalog). */
export function TrucksPanel() {
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
  useEscapeKey(onClose);
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
          <Select
            aria-label="Truck type"
            placeholder="Select type…"
            value={type}
            onChange={setType}
            options={TRUCK_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
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
          <Select
            aria-label="Default driver"
            value={defaultDriverId}
            onChange={setDefaultDriverId}
            options={[
              { value: "", label: "None" },
              ...drivers.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
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

/** The mill's drivers (also on Stock > Catalog). */
export function DriversPanel() {
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
                  <td className="px-4 py-3 text-secondary">
                    <CodeValue value={d.license_no} />
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
  useEscapeKey(onClose);
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [licenseNo, setLicenseNo] = useState(initial?.license_no ?? "");
  const [isPayroll, setIsPayroll] = useState(initial?.is_payroll ?? false);
  const [employeeId, setEmployeeId] = useState(initial?.employee_id ?? "");
  // Linking a payroll driver to an employee record needs Employees (Pro and up).
  const hasEmployees = useFeature("employees");

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ["employees"],
    queryFn: () => employeesService.list(),
    enabled: isPayroll && hasEmployees,
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        phone: phone || null,
        license_no: licenseNo || null,
        is_payroll: isPayroll,
        employee_id: isPayroll && hasEmployees && employeeId ? employeeId : null,
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
        {isPayroll && hasEmployees && (
          <div>
            <label className={LABEL}>Link to employee</label>
            <Select
              aria-label="Link to employee"
              placeholder="Choose an employee…"
              value={employeeId}
              onChange={setEmployeeId}
              options={[
                { value: "", label: "No employee" },
                ...employees.map((e: any) => ({ value: e.id, label: e.full_name })),
              ]}
            />
            <p className="text-[10px] text-muted mt-1">
              Optional. Links payroll records to this driver.
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
