import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { millingService, type ClientArrangement } from "../services/MillingService";
import { MillingMapper, estimateOutputs, DEFAULT_RECOVERY_PCT } from "../mappers/MillingMapper";
import { paddyService } from "../services/PaddyService";
import { Factory, Plus, X } from "lucide-react";
import { format } from "date-fns";
import QuickAdd from "../components/QuickAdd";
import { useAccess } from "../hooks/useAccess";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import EmptyState from "../components/EmptyState";
import FieldCaption from "../components/FieldCaption";
import Select from "../components/Select";
import DateTimePicker from "../components/DateTimePicker";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    in_progress: "badge-yellow",
    completed: "badge-green",
    cancelled: "badge-red",
  };
  return <span className={map[status] || "badge-gray"}>{status.replace("_", " ")}</span>;
}

// Output types the estimate fills in; broken rice (binlid) is weighed, not estimated.
type EstimatedType = "milled_rice" | "ipa" | "darak";
const ESTIMATED_TYPES: string[] = ["milled_rice", "ipa", "darak"];

const blankOutput = (output_type: string, grade_name = "") => ({
  output_type,
  variety_id: "",
  output_weight_kg: "",
  weight_manual: false,
  broken_rice_pct: "",
  grade_name,
});

const fmtKg = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

// Custom milling: what the client and the mill agreed, and what it does to stock.
const ARRANGEMENTS: { value: ClientArrangement; label: string; stock: string }[] = [
  {
    value: "client_takes_all",
    label: "Client takes everything",
    stock: "Nothing goes into your stock.",
  },
  {
    value: "mill_keeps_byproducts",
    label: "We keep the ipa and darak",
    stock: "The ipa and darak go into your Inventory; the bigas goes to the client.",
  },
  {
    value: "contracted",
    label: "Contracted",
    stock: "Write the terms in the notes. Nothing goes into your stock by itself.",
  },
];
const arrangementLabel = Object.fromEntries(ARRANGEMENTS.map((a) => [a.value, a.label]));

export default function MillingPage() {
  const qc = useQueryClient();
  const { canEdit } = useAccess();
  const [showForm, setShowForm] = useOpenOnArrival();
  useEscapeKey(() => setShowForm(false), showForm);

  const { data: batches = [] } = useQuery({
    queryKey: ["milling-batches"],
    queryFn: () => millingService.listBatches(),
  });
  const { data: equipment = [] } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => millingService.listEquipment(),
  });
  const { data: varieties = [] } = useQuery({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["milling-clients"],
    queryFn: () => millingService.listClients(),
  });
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));

  const [form, setForm] = useState({
    equipment_id: "",
    customer_id: "",
    client_arrangement: "client_takes_all" as ClientArrangement,
    client_notes: "",
    start_datetime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    remarks: "",
    inputs: [{ variety_id: "", grade_id: "", input_weight_kg: "", moisture_content_pct: "" }],
    outputs: [blankOutput("milled_rice", "regular"), blankOutput("ipa"), blankOutput("darak")],
  });

  // Each output weight follows the palay going in until someone types the
  // weighed kilos. Only the first row of a type takes the estimate, so a
  // second milled-rice row doesn't count the same rice twice.
  const estimate = estimateOutputs(
    form.inputs,
    Object.fromEntries(varieties.map((v: any) => [v.id, v.typical_recovery_pct])),
  );
  const estimateFor = (idx: number): number | null => {
    const type = form.outputs[idx].output_type;
    if (!ESTIMATED_TYPES.includes(type)) return null;
    if (form.outputs.findIndex((o) => o.output_type === type) !== idx) return null;
    return estimate[type as EstimatedType] || null;
  };
  const weightShown = (idx: number) => {
    const out = form.outputs[idx];
    if (out.weight_manual) return out.output_weight_kg;
    const est = estimateFor(idx);
    return est != null ? String(est) : "";
  };
  const setOutput = (idx: number, patch: Partial<(typeof form.outputs)[number]>) =>
    setForm((f) => ({
      ...f,
      outputs: f.outputs.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    }));
  const submit = () =>
    createMutation.mutate({
      ...form,
      outputs: form.outputs
        .map((o, idx) => ({ ...o, output_weight_kg: weightShown(idx) }))
        .filter((o) => parseFloat(o.output_weight_kg) > 0),
    });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => millingService.createBatch(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["milling-batches"] });
      // A batch uses palay and adds milled rice and by-products, so every
      // stock figure (Inventory, the dashboard, the buying pages) refreshes.
      for (const key of [
        "palay-inventory",
        "milled-rice",
        "byproducts",
        "inventory-summary",
        "rice-stock",
        "byproduct-stock",
      ])
        qc.invalidateQueries({ queryKey: [key] });
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
            Milling Operations
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Track milling batches, recovery rate, and by-products
          </p>
        </div>
        {canEdit("milling") && (
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            <Plus size={16} /> New Batch
          </button>
        )}
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">New Milling Batch</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <div className="flex items-baseline justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                  Client
                </label>
                <QuickAdd
                  label="New client"
                  endpoint="/milling/clients"
                  queryKey={["milling-clients"]}
                  fields={[
                    { key: "name", label: "Name", required: true, full: true },
                    {
                      key: "phone",
                      label: "Phone",
                      required: true,
                      placeholder: "e.g. 0917 123 4567",
                    },
                    { key: "address", label: "Address", placeholder: "Barangay, town" },
                  ]}
                  onCreated={(c) => setForm((f) => ({ ...f, customer_id: c.id }))}
                />
              </div>
              <Select
                aria-label="Client"
                value={form.customer_id}
                onChange={(v) => setForm((f) => ({ ...f, customer_id: v }))}
                options={[
                  { value: "", label: "Our own palay" },
                  ...clients
                    .filter((c) => c.is_active)
                    .map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              {form.customer_id && clientById[form.customer_id] ? (
                <p className="text-xs text-secondary mt-1">
                  {[clientById[form.customer_id].phone, clientById[form.customer_id].address]
                    .filter(Boolean)
                    .join(" · ") || "No phone or address on file."}
                </p>
              ) : (
                <p className="text-xs text-muted mt-1">
                  Whose palay is being milled. A walk-in? Add them with New client.
                </p>
              )}
            </div>
            {form.customer_id && (
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Arrangement
                  </label>
                  <Select
                    aria-label="Arrangement"
                    value={form.client_arrangement}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, client_arrangement: v as ClientArrangement }))
                    }
                    options={ARRANGEMENTS.map((a) => ({ value: a.value, label: a.label }))}
                  />
                  <p className="text-xs text-muted mt-1">
                    {ARRANGEMENTS.find((a) => a.value === form.client_arrangement)?.stock} The
                    client's palay isn't taken from your stock.
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="client-notes"
                    className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1"
                  >
                    Notes
                  </label>
                  <input
                    id="client-notes"
                    className="input"
                    maxLength={1000}
                    placeholder={
                      form.client_arrangement === "contracted"
                        ? "e.g. ₱150 per cavan, paid on pickup"
                        : "e.g. picks up tomorrow"
                    }
                    value={form.client_notes}
                    onChange={(e) => setForm((f) => ({ ...f, client_notes: e.target.value }))}
                  />
                </div>
              </div>
            )}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                  Equipment
                </label>
                <QuickAdd
                  label="New equipment"
                  endpoint="/milling/equipment"
                  queryKey={["equipment"]}
                  fields={[
                    {
                      key: "name",
                      label: "Name",
                      required: true,
                      full: true,
                      placeholder: "e.g. Mill #1",
                    },
                    { key: "model", label: "Model", placeholder: "e.g. SB-30" },
                    {
                      key: "capacity_kg_per_hr",
                      label: "Capacity (kg/hr)",
                      type: "number",
                      placeholder: "500",
                    },
                  ]}
                  transformBody={(b) => ({
                    ...b,
                    capacity_kg_per_hr: b.capacity_kg_per_hr
                      ? parseFloat(b.capacity_kg_per_hr)
                      : null,
                  })}
                  onCreated={(eq) => setForm((f) => ({ ...f, equipment_id: eq.id }))}
                />
              </div>
              <Select
                aria-label="Equipment"
                placeholder="Select equipment…"
                value={form.equipment_id}
                onChange={(v) => setForm((f) => ({ ...f, equipment_id: v }))}
                options={equipment.map((eq: any) => ({ value: eq.id, label: eq.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Start Date/Time
              </label>
              <DateTimePicker
                label="Start"
                value={form.start_datetime}
                onChange={(v) => setForm((f) => ({ ...f, start_datetime: v }))}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-slate-200">
                  Palay Inputs
                </p>
                <p className="text-xs text-muted">The palay you put into the mill.</p>
              </div>
              <div className="flex items-center gap-3">
                <QuickAdd
                  label="New variety"
                  endpoint="/paddy/varieties"
                  queryKey={["varieties"]}
                  fields={[
                    { key: "code", label: "Code", required: true, placeholder: "e.g. RC400" },
                    { key: "name", label: "Name", required: true },
                    {
                      key: "category",
                      label: "Category",
                      type: "select",
                      options: [
                        { value: "inbred", label: "Inbred" },
                        { value: "hybrid", label: "Hybrid" },
                        { value: "local", label: "Local" },
                      ],
                      default: "inbred",
                    },
                    {
                      key: "typical_recovery_pct",
                      label: "Recovery %",
                      type: "number",
                      placeholder: "65",
                    },
                  ]}
                  transformBody={(b) => ({
                    ...b,
                    code: String(b.code).toUpperCase(),
                    typical_recovery_pct: b.typical_recovery_pct
                      ? parseFloat(b.typical_recovery_pct)
                      : null,
                  })}
                />
                <button
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      inputs: [
                        ...f.inputs,
                        {
                          variety_id: "",
                          grade_id: "",
                          input_weight_kg: "",
                          moisture_content_pct: "",
                        },
                      ],
                    }))
                  }
                  className="text-sm text-brand-600 dark:text-brand-400"
                >
                  + Add
                </button>
              </div>
            </div>
            {form.inputs.map((inp, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
                <FieldCaption label="Variety">
                  <Select
                    aria-label="Variety"
                    placeholder="Variety"
                    value={inp.variety_id}
                    onChange={(v) => {
                      const inputs = [...form.inputs];
                      inputs[idx].variety_id = v;
                      setForm((f) => ({ ...f, inputs }));
                    }}
                    options={varieties.map((v: any) => ({ value: v.id, label: v.code }))}
                  />
                </FieldCaption>
                <FieldCaption label="Palay weight (kg)">
                  <input
                    className="input"
                    placeholder="Weight kg"
                    type="number"
                    value={inp.input_weight_kg}
                    onChange={(e) => {
                      const inputs = [...form.inputs];
                      inputs[idx].input_weight_kg = e.target.value;
                      setForm((f) => ({ ...f, inputs }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label="Moisture %">
                  <input
                    className="input"
                    placeholder="Moisture %"
                    type="number"
                    value={inp.moisture_content_pct}
                    onChange={(e) => {
                      const inputs = [...form.inputs];
                      inputs[idx].moisture_content_pct = e.target.value;
                      setForm((f) => ({ ...f, inputs }));
                    }}
                  />
                </FieldCaption>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-slate-200">Outputs</p>
                <p className="text-xs text-muted">
                  Worked out from the palay going in. Type the weighed kilos to replace an estimate.
                </p>
              </div>
              <button
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    outputs: [...f.outputs, blankOutput("binlid")],
                  }))
                }
                className="text-sm text-brand-600 dark:text-brand-400"
              >
                + Add
              </button>
            </div>
            {form.outputs.map((out, idx) => {
              const est = estimateFor(idx);
              return (
                <div key={idx} className="grid grid-cols-4 gap-2 mb-2 items-start">
                  <FieldCaption label="What came out">
                    <Select
                      aria-label="What came out"
                      value={out.output_type}
                      onChange={(v) => setOutput(idx, { output_type: v })}
                      options={[
                        { value: "milled_rice", label: "Milled Rice (Bigas)" },
                        { value: "ipa", label: "Ipa (Rice Hull)" },
                        { value: "darak", label: "Darak (Rice Bran)" },
                        { value: "binlid", label: "Binlid (Broken Rice)" },
                      ]}
                    />
                  </FieldCaption>
                  <div>
                    <FieldCaption label="Weight (kg)">
                      <input
                        className="input"
                        placeholder="Weight kg"
                        type="number"
                        value={weightShown(idx)}
                        onChange={(e) =>
                          // Clearing the box hands it back to the estimate.
                          setOutput(idx, {
                            output_weight_kg: e.target.value,
                            weight_manual: e.target.value !== "",
                          })
                        }
                      />
                    </FieldCaption>
                    {est != null &&
                      (out.weight_manual ? (
                        <button
                          type="button"
                          onClick={() =>
                            setOutput(idx, { output_weight_kg: "", weight_manual: false })
                          }
                          className="mt-1 text-xs text-brand-600 dark:text-brand-400"
                        >
                          Use estimate ({fmtKg(est)} kg)
                        </button>
                      ) : (
                        <p className="mt-1 text-xs text-muted">Estimated</p>
                      ))}
                  </div>
                  {out.output_type === "milled_rice" && (
                    <FieldCaption label="Broken rice %">
                      <input
                        className="input"
                        placeholder="Broken rice %"
                        type="number"
                        value={out.broken_rice_pct}
                        onChange={(e) => setOutput(idx, { broken_rice_pct: e.target.value })}
                      />
                    </FieldCaption>
                  )}
                  {form.outputs.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove this output"
                      title="Remove this output"
                      onClick={() =>
                        setForm((f) => ({ ...f, outputs: f.outputs.filter((_, i) => i !== idx) }))
                      }
                      className="mt-7 justify-self-start text-muted hover:text-red-600"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              );
            })}
            {estimate.palayKg > 0 && (
              <div className="mt-3 rounded-md bg-gray-50 dark:bg-slate-900/50 px-3 py-2 text-xs text-secondary space-y-1">
                <p>
                  From {fmtKg(estimate.palayKg)} kg palay
                  {estimate.adjustedKg !== estimate.palayKg &&
                    ` (${fmtKg(estimate.adjustedKg)} kg once dried to 14% moisture)`}
                  , expect about {fmtKg(estimate.milled_rice)} kg bigas
                  {estimate.recoveryPct != null &&
                    ` (${estimate.recoveryPct.toFixed(1)}% recovery)`}
                  , {fmtKg(estimate.ipa)} kg ipa and {fmtKg(estimate.darak)} kg darak
                  {estimate.lossKg > 0 &&
                    `, with about ${fmtKg(estimate.lossKg)} kg lost as moisture and dust`}
                  .
                </p>
                <p className="text-muted">
                  Bigas uses each variety's Recovery % ({DEFAULT_RECOVERY_PCT}% when it has none).
                  Ipa is 20% of the palay and darak about 10%.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={submit} className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Start Batch"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
            <tr>
              {[
                "Batch No.",
                "Client",
                "Start",
                "Status",
                "Inputs (kg)",
                "Milled Rice (kg)",
                "Recovery %",
              ].map((h) => (
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
            {batches.map((b: any) => {
              const { totalInput, milledKg, recovery } = MillingMapper.summarizeBatch(b);
              return (
                <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3 font-mono text-xs">{b.batch_no}</td>
                  <td className="px-4 py-3">
                    {b.customer_id && clientById[b.customer_id] ? (
                      <>
                        <span className="block">{clientById[b.customer_id].name}</span>
                        {b.client_arrangement && (
                          <span
                            className="block max-w-[16rem] truncate text-xs text-muted"
                            title={b.client_notes || undefined}
                          >
                            {arrangementLabel[b.client_arrangement] ?? b.client_arrangement}
                            {b.client_notes && ` · ${b.client_notes}`}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {b.start_datetime
                      ? format(new Date(b.start_datetime), "MMM d, yyyy HH:mm")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3">{totalInput.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {milledKg != null ? milledKg.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {recovery != null ? `${recovery.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
            {batches.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={Factory}
                    title="No milling batches yet"
                    action={canEdit("milling") ? "Start your first batch" : undefined}
                    onAction={() => setShowForm(true)}
                    next="The rice and by-products you enter go straight into Inventory, ready to sell."
                  >
                    A batch records how much palay went into the mill and how much rice came out.
                    Oraiza works out the recovery rate for you.
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
