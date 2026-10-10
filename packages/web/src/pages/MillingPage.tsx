import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { millingService } from "../services/MillingService";
import { MillingMapper } from "../mappers/MillingMapper";
import { paddyService } from "../services/PaddyService";
import { Factory, Plus } from "lucide-react";
import { format } from "date-fns";
import QuickAdd from "../components/QuickAdd";
import { useAccess } from "../hooks/useAccess";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import EmptyState from "../components/EmptyState";
import FieldCaption from "../components/FieldCaption";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    in_progress: "badge-yellow",
    completed: "badge-green",
    cancelled: "badge-red",
  };
  return <span className={map[status] || "badge-gray"}>{status.replace("_", " ")}</span>;
}

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

  const [form, setForm] = useState({
    equipment_id: "",
    start_datetime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    remarks: "",
    inputs: [{ variety_id: "", grade_id: "", input_weight_kg: "", moisture_content_pct: "" }],
    outputs: [
      {
        output_type: "milled_rice",
        variety_id: "",
        output_weight_kg: "",
        broken_rice_pct: "",
        grade_name: "regular",
      },
    ],
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => millingService.createBatch(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["milling-batches"] });
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
              <select
                className="input"
                value={form.equipment_id}
                onChange={(e) => setForm((f) => ({ ...f, equipment_id: e.target.value }))}
              >
                <option value="">Select equipment…</option>
                {equipment.map((eq: any) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Start Date/Time
              </label>
              <input
                type="datetime-local"
                className="input"
                value={form.start_datetime}
                onChange={(e) => setForm((f) => ({ ...f, start_datetime: e.target.value }))}
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
                  <select
                    className="input"
                    value={inp.variety_id}
                    onChange={(e) => {
                      const inputs = [...form.inputs];
                      inputs[idx].variety_id = e.target.value;
                      setForm((f) => ({ ...f, inputs }));
                    }}
                  >
                    <option value="">Variety</option>
                    {varieties.map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.code}
                      </option>
                    ))}
                  </select>
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
                  The rice that came out, plus hull, bran or broken rice (add a row for each).
                </p>
              </div>
              <button
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    outputs: [
                      ...f.outputs,
                      {
                        output_type: "ipa",
                        variety_id: "",
                        output_weight_kg: "",
                        broken_rice_pct: "",
                        grade_name: "",
                      },
                    ],
                  }))
                }
                className="text-sm text-brand-600 dark:text-brand-400"
              >
                + Add
              </button>
            </div>
            {form.outputs.map((out, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
                <FieldCaption label="What came out">
                  <select
                    className="input"
                    value={out.output_type}
                    onChange={(e) => {
                      const outputs = [...form.outputs];
                      outputs[idx].output_type = e.target.value;
                      setForm((f) => ({ ...f, outputs }));
                    }}
                  >
                    <option value="milled_rice">Milled Rice (Bigas)</option>
                    <option value="ipa">Ipa (Rice Hull)</option>
                    <option value="darak">Darak (Rice Bran)</option>
                    <option value="binlid">Binlid (Broken Rice)</option>
                  </select>
                </FieldCaption>
                <FieldCaption label="Weight (kg)">
                  <input
                    className="input"
                    placeholder="Weight kg"
                    type="number"
                    value={out.output_weight_kg}
                    onChange={(e) => {
                      const outputs = [...form.outputs];
                      outputs[idx].output_weight_kg = e.target.value;
                      setForm((f) => ({ ...f, outputs }));
                    }}
                  />
                </FieldCaption>
                {out.output_type === "milled_rice" && (
                  <FieldCaption label="Broken rice %">
                    <input
                      className="input"
                      placeholder="Broken rice %"
                      type="number"
                      value={out.broken_rice_pct}
                      onChange={(e) => {
                        const outputs = [...form.outputs];
                        outputs[idx].broken_rice_pct = e.target.value;
                        setForm((f) => ({ ...f, outputs }));
                      }}
                    />
                  </FieldCaption>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate(form)}
              className="btn-primary"
              disabled={createMutation.isPending}
            >
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
                <td colSpan={6}>
                  <EmptyState
                    icon={Factory}
                    title="No milling batches yet"
                    action={canEdit("milling") ? "Start your first batch" : undefined}
                    onAction={() => setShowForm(true)}
                    next="The rice and by-products you enter go straight into Inventory, ready to sell."
                  >
                    A batch records how much palay went into the mill and how much rice came out.
                    Oryza works out the recovery rate for you.
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
