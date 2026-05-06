import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import QuickAdd from "../components/QuickAdd";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { in_progress: "badge-yellow", completed: "badge-green", cancelled: "badge-red" };
  return <span className={map[status] || "badge-gray"}>{status.replace("_", " ")}</span>;
}

export default function MillingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: batches = [] } = useQuery({ queryKey: ["milling-batches"], queryFn: () => api.get("/milling/batches").then(r => r.data) });
  const { data: equipment = [] } = useQuery({ queryKey: ["equipment"], queryFn: () => api.get("/milling/equipment").then(r => r.data) });
  const { data: varieties = [] } = useQuery({ queryKey: ["varieties"], queryFn: () => api.get("/paddy/varieties").then(r => r.data) });

  const [form, setForm] = useState({
    equipment_id: "", start_datetime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    remarks: "",
    inputs: [{ variety_id: "", grade_id: "", input_weight_kg: "", moisture_content_pct: "" }],
    outputs: [{ output_type: "milled_rice", variety_id: "", output_weight_kg: "", broken_rice_pct: "", grade_name: "regular" }],
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => api.post("/milling/batches", {
      ...body,
      equipment_id: body.equipment_id || null,
      inputs: body.inputs.map(i => ({ ...i, input_weight_kg: parseFloat(i.input_weight_kg), moisture_content_pct: i.moisture_content_pct ? parseFloat(i.moisture_content_pct) : null, variety_id: i.variety_id || null, grade_id: i.grade_id || null })),
      outputs: body.outputs.map(o => ({ ...o, output_weight_kg: parseFloat(o.output_weight_kg), broken_rice_pct: o.broken_rice_pct ? parseFloat(o.broken_rice_pct) : null, variety_id: o.variety_id || null })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["milling-batches"] }); setShowForm(false); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Milling Operations</h2>
          <p className="text-sm text-gray-500">Track milling batches, recovery rate, and by-products</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> New Batch
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900">New Milling Batch</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Equipment</label>
                <QuickAdd
                  label="New equipment"
                  endpoint="/milling/equipment"
                  queryKey={["equipment"]}
                  fields={[
                    { key: "name", label: "Name", required: true, full: true, placeholder: "e.g. Mill #1" },
                    { key: "model", label: "Model", placeholder: "e.g. SB-30" },
                    { key: "capacity_kg_per_hr", label: "Capacity (kg/hr)", type: "number", placeholder: "500" },
                  ]}
                  transformBody={(b) => ({ ...b, capacity_kg_per_hr: b.capacity_kg_per_hr ? parseFloat(b.capacity_kg_per_hr) : null })}
                  onCreated={(eq) => setForm((f) => ({ ...f, equipment_id: eq.id }))}
                />
              </div>
              <select className="input" value={form.equipment_id} onChange={e => setForm(f => ({ ...f, equipment_id: e.target.value }))}>
                <option value="">Select equipment…</option>
                {equipment.map((eq: any) => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date/Time</label>
              <input type="datetime-local" className="input" value={form.start_datetime} onChange={e => setForm(f => ({ ...f, start_datetime: e.target.value }))} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Palay Inputs</p>
              <div className="flex items-center gap-3">
                <QuickAdd
                  label="New variety"
                  endpoint="/paddy/varieties"
                  queryKey={["varieties"]}
                  fields={[
                    { key: "code", label: "Code", required: true, placeholder: "e.g. RC400" },
                    { key: "name", label: "Name", required: true },
                    { key: "category", label: "Category", type: "select", options: [
                      { value: "inbred", label: "Inbred" },
                      { value: "hybrid", label: "Hybrid" },
                      { value: "local", label: "Local" },
                    ], default: "inbred" },
                    { key: "typical_recovery_pct", label: "Recovery %", type: "number", placeholder: "65" },
                  ]}
                  transformBody={(b) => ({
                    ...b,
                    code: String(b.code).toUpperCase(),
                    typical_recovery_pct: b.typical_recovery_pct ? parseFloat(b.typical_recovery_pct) : null,
                  })}
                />
                <button onClick={() => setForm(f => ({ ...f, inputs: [...f.inputs, { variety_id: "", grade_id: "", input_weight_kg: "", moisture_content_pct: "" }] }))} className="text-sm text-brand-600">+ Add</button>
              </div>
            </div>
            {form.inputs.map((inp, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
                <select className="input" value={inp.variety_id} onChange={e => { const inputs = [...form.inputs]; inputs[idx].variety_id = e.target.value; setForm(f => ({ ...f, inputs })); }}>
                  <option value="">Variety</option>
                  {varieties.map((v: any) => <option key={v.id} value={v.id}>{v.code}</option>)}
                </select>
                <input className="input" placeholder="Weight kg" type="number" value={inp.input_weight_kg} onChange={e => { const inputs = [...form.inputs]; inputs[idx].input_weight_kg = e.target.value; setForm(f => ({ ...f, inputs })); }} />
                <input className="input" placeholder="Moisture %" type="number" value={inp.moisture_content_pct} onChange={e => { const inputs = [...form.inputs]; inputs[idx].moisture_content_pct = e.target.value; setForm(f => ({ ...f, inputs })); }} />
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Outputs</p>
              <button onClick={() => setForm(f => ({ ...f, outputs: [...f.outputs, { output_type: "ipa", variety_id: "", output_weight_kg: "", broken_rice_pct: "", grade_name: "" }] }))} className="text-sm text-brand-600">+ Add</button>
            </div>
            {form.outputs.map((out, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
                <select className="input" value={out.output_type} onChange={e => { const outputs = [...form.outputs]; outputs[idx].output_type = e.target.value; setForm(f => ({ ...f, outputs })); }}>
                  <option value="milled_rice">Milled Rice (Bigas)</option>
                  <option value="ipa">Ipa (Rice Hull)</option>
                  <option value="darak">Darak (Rice Bran)</option>
                  <option value="binlid">Binlid (Broken Rice)</option>
                </select>
                <input className="input" placeholder="Weight kg" type="number" value={out.output_weight_kg} onChange={e => { const outputs = [...form.outputs]; outputs[idx].output_weight_kg = e.target.value; setForm(f => ({ ...f, outputs })); }} />
                {out.output_type === "milled_rice" && (
                  <input className="input" placeholder="Broken rice %" type="number" value={out.broken_rice_pct} onChange={e => { const outputs = [...form.outputs]; outputs[idx].broken_rice_pct = e.target.value; setForm(f => ({ ...f, outputs })); }} />
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => createMutation.mutate(form)} className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Start Batch"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {["Batch No.", "Start", "Status", "Inputs (kg)", "Milled Rice (kg)", "Recovery %"].map(h => (
                <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {batches.map((b: any) => {
              const totalInput = b.inputs?.reduce((s: number, i: any) => s + Number(i.input_weight_kg), 0) || 0;
              const milledOutput = b.outputs?.find((o: any) => o.output_type === "milled_rice");
              const recovery = milledOutput && totalInput > 0 ? ((Number(milledOutput.output_weight_kg) / totalInput) * 100).toFixed(1) : "—";
              return (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{b.batch_no}</td>
                  <td className="px-4 py-3">{b.start_datetime ? format(new Date(b.start_datetime), "MMM d, yyyy HH:mm") : "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3">{totalInput.toLocaleString()}</td>
                  <td className="px-4 py-3">{milledOutput ? Number(milledOutput.output_weight_kg).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3">{recovery !== "—" ? `${recovery}%` : "—"}</td>
                </tr>
              );
            })}
            {batches.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No milling batches yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
