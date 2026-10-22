// Maintenance: each machine against the manufacturer's service interval, in
// running hours, tonnes milled or days, counted from the milling since its last
// service. Recording a service starts the count again.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Wrench } from "lucide-react";
import { useAccess } from "../hooks/useAccess";
import DatePicker from "../components/DatePicker";
import { maintenanceService, type Machine } from "../services/MaintenanceService";

const isoToday = () => new Date().toLocaleDateString("en-CA");
const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string")
    return String(detail[0].msg).replace(/^Value error, /, "");
  return fallback;
}

const STATUS: Record<Machine["status"], { label: string; badge: string }> = {
  due: { label: "Service due", badge: "badge-red" },
  soon: { label: "Due soon", badge: "badge-yellow" },
  ok: { label: "OK", badge: "badge-green" },
  off: { label: "Not in use", badge: "badge-gray" },
};

function MachineCard({ machine, canEdit }: { machine: Machine; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [servicing, setServicing] = useState(false);
  const [doneOn, setDoneOn] = useState(isoToday());
  const [note, setNote] = useState("");
  const [showLog, setShowLog] = useState(false);
  const log = useQuery({
    queryKey: ["maintenance-log", machine.id],
    queryFn: () => maintenanceService.log(machine.id),
    enabled: showLog,
  });
  const service = useMutation({
    mutationFn: () => maintenanceService.service(machine.id, { done_on: doneOn, note }),
    onSuccess: () => {
      setServicing(false);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      void queryClient.invalidateQueries({ queryKey: ["maintenance-log", machine.id] });
    },
  });
  const status = STATUS[machine.status];
  return (
    <article aria-labelledby={`machine-${machine.id}`} className="card !p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 id={`machine-${machine.id}`} className="font-bold text-primary">
          {machine.name}
        </h3>
        <span className={status.badge}>{status.label}</span>
      </div>
      <p className="text-sm text-secondary">
        Since its last service on {day(machine.last_service_on)}: {machine.summary}.
      </p>
      {machine.notes && <p className="text-xs text-muted">{machine.notes}</p>}
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button type="button" className="btn-primary" onClick={() => setServicing((s) => !s)}>
            <Wrench size={15} aria-hidden />
            Record a service
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={() => setShowLog((s) => !s)}>
          {showLog ? "Hide services" : "Past services"}
        </button>
      </div>
      {servicing && (
        <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-soft">
          <div>
            <label htmlFor={`done-${machine.id}`} className="form-label">
              Done on
            </label>
            <DatePicker
              id={`done-${machine.id}`}
              className="w-44"
              max={isoToday()}
              value={doneOn}
              onChange={setDoneOn}
            />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor={`what-${machine.id}`} className="form-label">
              What was done
            </label>
            <input
              id={`what-${machine.id}`}
              className="input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={!doneOn || service.isPending}
            onClick={() => service.mutate()}
          >
            Save
          </button>
        </div>
      )}
      {service.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(service.error, "Couldn't record the service. Try again.")}
        </p>
      )}
      {showLog && (
        <ul className="space-y-1 text-sm" aria-label={`Services of ${machine.name}`}>
          {(log.data?.log ?? []).map((entry) => (
            <li key={entry.id}>
              <span className="text-muted">{day(entry.done_on)}:</span>{" "}
              <span className="text-primary">{entry.note ?? "Serviced"}</span>
              {entry.done_by && <span className="text-secondary"> ({entry.done_by})</span>}
            </li>
          ))}
          {log.data && log.data.log.length === 0 && (
            <li className="text-secondary">No services recorded here yet.</li>
          )}
        </ul>
      )}
    </article>
  );
}

function AddMachine({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [hours, setHours] = useState("");
  const [tonnes, setTonnes] = useState("");
  const [days, setDays] = useState("");
  const [last, setLast] = useState(isoToday());
  const add = useMutation({
    mutationFn: () =>
      maintenanceService.add({
        name,
        every_hours: hours ? Number(hours) : null,
        every_tonnes: tonnes ? Number(tonnes) : null,
        every_days: days ? Number(days) : null,
        last_service_on: last,
        notes: "",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      onDone();
    },
  });
  const digits = (v: string) => v.replace(/[^\d.]/g, "");
  return (
    <section aria-label="Add a machine" className="card space-y-4">
      <p className="text-sm text-secondary">
        Use the manufacturer's service intervals; fill in any of them.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="machine-name" className="form-label">
            Machine
          </label>
          <input
            id="machine-name"
            className="input"
            placeholder="e.g. Rubber-roll huller"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="machine-last" className="form-label">
            Last serviced on
          </label>
          <DatePicker id="machine-last" max={isoToday()} value={last} onChange={setLast} />
        </div>
        <div>
          <label htmlFor="machine-hours" className="form-label">
            Every (running hours)
          </label>
          <input
            id="machine-hours"
            inputMode="numeric"
            className="input"
            value={hours}
            onChange={(e) => setHours(digits(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="machine-tonnes" className="form-label">
            Every (tonnes of palay milled)
          </label>
          <input
            id="machine-tonnes"
            inputMode="decimal"
            className="input"
            value={tonnes}
            onChange={(e) => setTonnes(digits(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="machine-days" className="form-label">
            Every (days)
          </label>
          <input
            id="machine-days"
            inputMode="numeric"
            className="input"
            value={days}
            onChange={(e) => setDays(digits(e.target.value))}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!name.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          Add the machine
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      {add.isError && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {errorText(add.error, "Couldn't add the machine. Try again.")}
        </p>
      )}
    </section>
  );
}

export default function MaintenancePage() {
  const { canEdit } = useAccess();
  const list = useQuery({ queryKey: ["maintenance"], queryFn: () => maintenanceService.list() });
  const [adding, setAdding] = useState(false);
  const machines = list.data?.equipment ?? [];
  const editable = canEdit("milling");

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary">Maintenance</h1>
          <p className="text-secondary mt-1 max-w-2xl">
            Each machine against its service interval, counted from the milling since its last
            service.
          </p>
        </div>
        {editable && !adding && (
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden />
            Add a machine
          </button>
        )}
      </header>
      {adding && <AddMachine onDone={() => setAdding(false)} />}
      {list.isLoading ? (
        <div className="card skeleton h-40" aria-busy="true" />
      ) : list.isError ? (
        <div className="card">
          <p className="text-secondary">
            {errorText(list.error, "Maintenance couldn't load. Try again in a moment.")}
          </p>
        </div>
      ) : machines.length === 0 ? (
        <div className="card text-center py-10">
          <Wrench size={28} className="mx-auto text-emerald-600 dark:text-emerald-400" />
          <p className="font-semibold text-primary mt-2">No machines yet.</p>
          <p className="text-sm text-secondary mt-1">
            Add your huller, polisher, dryer or engine with its service interval.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {machines.map((m) => (
            <MachineCard key={m.id} machine={m} canEdit={editable} />
          ))}
        </div>
      )}
    </div>
  );
}
