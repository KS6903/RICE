// Correcting a saved milling batch (edit power): its machine, client, times,
// remarks, the palay that went in and what came out. When the palay, the
// outputs or the client change, stock follows; every changed field goes in the
// batch's history.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import RecordDialog from "../sales/RecordDialog";
import Select from "../Select";
import DateTimePicker from "../DateTimePicker";
import { millingService, type ClientArrangement } from "../../services/MillingService";
import { t } from "../../i18n";

type Input = {
  variety_id: string;
  grade_id: string;
  input_weight_kg: string;
  moisture_content_pct: string;
};
type Output = {
  output_type: string;
  variety_id: string;
  output_weight_kg: string;
  broken_rice_pct: string;
};

const OUTPUT_TYPES = [
  { value: "milled_rice", label: t("Milled Rice (Bigas)") },
  { value: "ipa", label: t("Ipa (Rice Hull)") },
  { value: "darak", label: t("Darak (Rice Bran)") },
  { value: "binlid", label: t("Binlid (Broken Rice)") },
];

const ARRANGEMENTS: { value: ClientArrangement; label: string }[] = [
  { value: "client_takes_all", label: t("Client takes everything") },
  { value: "mill_keeps_byproducts", label: t("We keep the ipa and darak") },
  { value: "contracted", label: t("Contracted") },
];

const text = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
const local = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "";
const numberOrNull = (v: string) => (v === "" ? null : parseFloat(v));

export default function EditBatchDialog({
  batch,
  equipment,
  varieties,
  outputVarieties,
  clients,
  onClose,
}: {
  batch: any;
  equipment: { id: string; name: string }[];
  /** The palay going in. */
  varieties: { id: string; code: string }[];
  /** The rice coming out; left out, the same list as the palay. */
  outputVarieties?: { id: string; code: string }[];
  clients: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [equipmentId, setEquipmentId] = useState<string>(batch.equipment_id ?? "");
  const [customerId, setCustomerId] = useState<string>(batch.customer_id ?? "");
  const [arrangement, setArrangement] = useState<ClientArrangement>(
    batch.client_arrangement ?? "client_takes_all",
  );
  const [clientNotes, setClientNotes] = useState<string>(batch.client_notes ?? "");
  // Times are sent only when changed, as the instant picked here.
  const [start, setStart] = useState<string>(local(batch.start_datetime));
  const [end, setEnd] = useState<string>(local(batch.end_datetime));
  const [remarks, setRemarks] = useState<string>(batch.remarks ?? "");
  const [inputs, setInputs] = useState<Input[]>(
    (batch.inputs ?? []).map((i: any) => ({
      variety_id: i.variety_id ?? "",
      grade_id: i.grade_id ?? "",
      input_weight_kg: text(i.input_weight_kg),
      moisture_content_pct: text(i.moisture_content_pct),
    })),
  );
  const [outputs, setOutputs] = useState<Output[]>(
    (batch.outputs ?? []).map((o: any) => ({
      output_type: o.output_type,
      variety_id: o.variety_id ?? "",
      output_weight_kg: text(o.output_weight_kg),
      broken_rice_pct: text(o.broken_rice_pct),
    })),
  );

  const valid =
    !!start &&
    inputs.length > 0 &&
    inputs.every((i) => parseFloat(i.input_weight_kg) > 0) &&
    outputs.every((o) => parseFloat(o.output_weight_kg) > 0);

  const save = useMutation({
    mutationFn: () =>
      millingService.editBatch(batch.id, {
        equipment_id: equipmentId || null,
        customer_id: customerId || null,
        client_arrangement: customerId ? arrangement : null,
        client_notes: (customerId && clientNotes.trim()) || null,
        remarks: remarks.trim() || null,
        ...(start !== local(batch.start_datetime)
          ? { start_datetime: new Date(start).toISOString() }
          : {}),
        ...(end && end !== local(batch.end_datetime)
          ? { end_datetime: new Date(end).toISOString() }
          : {}),
        inputs: inputs.map((i) => ({
          variety_id: i.variety_id || null,
          grade_id: i.grade_id || null,
          input_weight_kg: parseFloat(i.input_weight_kg),
          moisture_content_pct: numberOrNull(i.moisture_content_pct),
        })),
        outputs: outputs.map((o) => ({
          output_type: o.output_type,
          variety_id: o.variety_id || null,
          output_weight_kg: parseFloat(o.output_weight_kg),
          broken_rice_pct: numberOrNull(o.broken_rice_pct),
        })),
      }),
    onSuccess: () => {
      // The batch, and every stock figure it touches.
      for (const key of [
        "milling-batches",
        "palay-inventory",
        "milled-rice",
        "byproducts",
        "inventory-summary",
        "rice-stock",
        "byproduct-stock",
        "record-history",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;

  const setInput = (i: number, patch: Partial<Input>) =>
    setInputs((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setOutput = (i: number, patch: Partial<Output>) =>
    setOutputs((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const optionsOf = (list: { id: string; code: string }[]) => [
    { value: "", label: t("Any variety") },
    ...list.map((v) => ({ value: v.id, label: v.code })),
  ];
  const varietyOptions = optionsOf(varieties);
  const outputVarietyOptions = optionsOf(outputVarieties ?? varieties);

  return (
    <RecordDialog
      title={t("Edit batch {{batch_no}}", { batch_no: batch.batch_no })}
      subtitle={t(
        "Stock follows the palay and outputs you save, and every change goes in the batch's history.",
      )}
      onClose={onClose}
      busy={save.isPending}
      testId="edit-batch"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={!valid || save.isPending}
          >
            {save.isPending ? t("Saving…") : t("Save changes")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Machine")}</span>
            <Select
              aria-label={t("Machine")}
              value={equipmentId}
              onChange={setEquipmentId}
              options={[
                { value: "", label: t("No machine") },
                ...equipment.map((e) => ({ value: e.id, label: e.name })),
              ]}
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">
              {t("Whose palay")}
            </span>
            <Select
              aria-label={t("Client")}
              value={customerId}
              onChange={setCustomerId}
              options={[
                { value: "", label: t("The mill's own") },
                ...clients.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </label>
          {customerId && (
            <>
              <label className="block">
                <span className="block mb-1 text-xs font-medium text-secondary">
                  {t("Arrangement")}
                </span>
                <Select
                  aria-label={t("Arrangement")}
                  value={arrangement}
                  onChange={(v) => setArrangement(v as ClientArrangement)}
                  options={ARRANGEMENTS}
                />
              </label>
              <label className="block">
                <span className="block mb-1 text-xs font-medium text-secondary">
                  {t("Client notes")}
                </span>
                <input
                  className="input"
                  maxLength={1000}
                  aria-label={t("Client notes")}
                  value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)}
                />
              </label>
            </>
          )}
          <div>
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Started")}</span>
            <DateTimePicker label={t("Started")} value={start} onChange={setStart} />
          </div>
          {batch.end_datetime && (
            <div>
              <span className="block mb-1 text-xs font-medium text-secondary">{t("Finished")}</span>
              <DateTimePicker label={t("Finished")} value={end} onChange={setEnd} />
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-secondary">{t("Palay in")}</p>
          <div className="space-y-2">
            {inputs.map((inp, i) => (
              <div
                key={i}
                className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto] items-end gap-2"
              >
                <Select
                  aria-label={t("Variety of palay {{value}}", { value: i + 1 })}
                  value={inp.variety_id}
                  onChange={(v) => setInput(i, { variety_id: v })}
                  options={varietyOptions}
                />
                <label className="block">
                  <span className="block mb-1 text-[11px] text-muted">{t("Kilos")}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    aria-label={t("Kilos of palay {{value}}", { value: i + 1 })}
                    value={inp.input_weight_kg}
                    onChange={(e) => setInput(i, { input_weight_kg: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="block mb-1 text-[11px] text-muted">{t("Moisture %")}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    aria-label={t("Moisture of palay {{value}}", { value: i + 1 })}
                    value={inp.moisture_content_pct}
                    onChange={(e) => setInput(i, { moisture_content_pct: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost !p-2 mb-0.5"
                  aria-label={t("Remove palay {{value}}", { value: i + 1 })}
                  disabled={inputs.length === 1}
                  onClick={() => setInputs((xs) => xs.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost text-sm mt-1"
            onClick={() =>
              setInputs((xs) => [
                ...xs,
                { variety_id: "", grade_id: "", input_weight_kg: "", moisture_content_pct: "" },
              ])
            }
          >
            <Plus size={15} /> {t("Add palay")}
          </button>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-secondary">{t("What came out")}</p>
          <div className="space-y-2">
            {outputs.map((out, i) => (
              <div
                key={i}
                className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_auto] items-end gap-2"
              >
                <Select
                  aria-label={t("Output {{value}}", { value: i + 1 })}
                  value={out.output_type}
                  onChange={(v) => setOutput(i, { output_type: v })}
                  options={OUTPUT_TYPES}
                />
                {out.output_type === "milled_rice" ? (
                  <Select
                    aria-label={t("Variety of output {{value}}", { value: i + 1 })}
                    value={out.variety_id}
                    onChange={(v) => setOutput(i, { variety_id: v })}
                    options={outputVarietyOptions}
                  />
                ) : (
                  <span />
                )}
                <label className="block">
                  <span className="block mb-1 text-[11px] text-muted">{t("Kilos")}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    aria-label={t("Kilos of output {{value}}", { value: i + 1 })}
                    value={out.output_weight_kg}
                    onChange={(e) => setOutput(i, { output_weight_kg: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost !p-2 mb-0.5"
                  aria-label={t("Remove output {{value}}", { value: i + 1 })}
                  onClick={() => setOutputs((xs) => xs.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost text-sm mt-1"
            onClick={() =>
              setOutputs((xs) => [
                ...xs,
                {
                  output_type: "binlid",
                  variety_id: "",
                  output_weight_kg: "",
                  broken_rice_pct: "",
                },
              ])
            }
          >
            <Plus size={15} /> {t("Add output")}
          </button>
        </div>

        <label className="block">
          <span className="block mb-1 text-xs font-medium text-secondary">{t("Remarks")}</span>
          <textarea
            className="input min-h-[4rem]"
            aria-label={t("Remarks")}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {typeof error === "string"
              ? error
              : t("Couldn't save. Check the fields and try again.")}
          </p>
        )}
      </div>
    </RecordDialog>
  );
}
