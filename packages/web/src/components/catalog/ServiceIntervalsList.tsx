// Stock > Catalog's service intervals: how often each machine on the
// Maintenance page is serviced (Enterprise, with the automations). Recording a
// service stays on the Maintenance page; here the Boss adds machines and sets
// their intervals.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { maintenanceService, type Machine } from "../../services/MaintenanceService";
import { AddMachine, errorText } from "../../pages/MaintenancePage";

const TABLE_HEAD =
  "px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

type IntervalEdit = {
  machine: Machine;
  name: string;
  hours: string;
  tonnes: string;
  days: string;
  inUse: boolean;
};

/** "500 running hours or 30 days": whichever comes first. */
const every = (m: Machine) =>
  [
    m.every_hours && `${m.every_hours.toLocaleString()} running hours`,
    m.every_tonnes && `${m.every_tonnes.toLocaleString()} tonnes milled`,
    m.every_days && `${m.every_days.toLocaleString()} days`,
  ]
    .filter(Boolean)
    .join(" or ");

const digits = (v: string) => v.replace(/[^\d.]/g, "");
const numberOrNull = (v: string) => (v ? Number(v) : null);

export function ServiceIntervalsList() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["maintenance"], queryFn: () => maintenanceService.list() });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<IntervalEdit | null>(null);
  const machines = list.data?.equipment ?? [];

  const save = useMutation({
    mutationFn: (e: IntervalEdit) =>
      maintenanceService.edit(e.machine.id, {
        name: e.name.trim(),
        every_hours: numberOrNull(e.hours),
        every_tonnes: numberOrNull(e.tonnes),
        every_days: numberOrNull(e.days),
        last_service_on: e.machine.last_service_on,
        notes: e.machine.notes ?? "",
        is_active: e.inUse,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["maintenance"] });
      setEditing(null);
    },
  });

  const startEdit = (m: Machine) => {
    save.reset();
    setEditing({
      machine: m,
      name: m.name,
      hours: m.every_hours?.toString() ?? "",
      tonnes: m.every_tonnes?.toString() ?? "",
      days: m.every_days?.toString() ?? "",
      inUse: m.is_active,
    });
  };

  const intervalInput = (key: "hours" | "tonnes" | "days", label: string) =>
    editing && (
      <input
        className="input w-28"
        aria-label={label}
        inputMode={key === "tonnes" ? "decimal" : "numeric"}
        value={editing[key]}
        onChange={(e) => setEditing({ ...editing, [key]: digits(e.target.value) })}
      />
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Use the manufacturer's intervals, in running hours, tonnes of palay milled or days; the
        machine is due at whichever comes first. Record each service on the Maintenance page.
      </p>
      {!adding && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden />
            Add a machine
          </button>
        </div>
      )}
      {adding && <AddMachine onDone={() => setAdding(false)} />}

      {list.isLoading ? (
        <div className="card skeleton h-40" aria-busy="true" />
      ) : list.isError ? (
        <p className="card text-secondary">
          {errorText(list.error, "The machines couldn't load. Try again in a moment.")}
        </p>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
              <tr>
                {["Machine", "Service every", "Status", ""].map((h) => (
                  <th key={h} className={TABLE_HEAD}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
              {machines.map((m) =>
                editing && editing.machine.id === m.id ? (
                  <tr key={m.id} className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="px-4 py-2.5 align-top">
                      <input
                        className="input"
                        aria-label="Machine name"
                        maxLength={120}
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      />
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                        {intervalInput("hours", "Every (running hours)")} hours
                        {intervalInput("tonnes", "Every (tonnes of palay milled)")} tonnes
                        {intervalInput("days", "Every (days)")} days
                      </div>
                      {save.isError && (
                        <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                          {errorText(save.error, "Couldn't save the machine.")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-soft accent-emerald-500 cursor-pointer"
                          checked={editing.inUse}
                          onChange={(e) => setEditing({ ...editing, inUse: e.target.checked })}
                        />
                        In use
                      </label>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="btn-secondary"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => save.mutate(editing)}
                          className="btn-primary"
                          disabled={
                            save.isPending ||
                            !editing.name.trim() ||
                            !(editing.hours || editing.tonnes || editing.days)
                          }
                        >
                          {save.isPending ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={m.id}
                    className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors ${
                      !m.is_active ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-primary">{m.name}</td>
                    <td className="px-4 py-3 text-secondary">{every(m)}</td>
                    <td className="px-4 py-3">
                      {m.is_active ? (
                        <span className="badge-green">In use</span>
                      ) : (
                        <span className="badge-gray">Not in use</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          aria-label={`Edit ${m.name}`}
                          onClick={() => startEdit(m)}
                          className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
                        >
                          <Pencil size={12} />
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {machines.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted font-medium">
                    No machines yet. Add your huller, polisher, dryer or engine.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
