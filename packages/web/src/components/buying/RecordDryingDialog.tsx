// A wet palay line has been dried: record what it weighs now and its moisture.
// The line turns green, its stock becomes the dried weight, and the purchase is
// completed once none of its lines is still wet. Both figures are required: a wet
// line is not finished until they are in.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import RecordDialog from "../sales/RecordDialog";
import FieldCaption from "../FieldCaption";
import { paddyService } from "../../services/PaddyService";
import { fixFields, needsInput } from "../../utils/required";
import { t } from "../../i18n";

const kg = (v: unknown) => Number(v ?? 0).toLocaleString();

export default function RecordDryingDialog({
  purchase,
  line,
  onClose,
}: {
  purchase: any;
  line: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [weight, setWeight] = useState("");
  const [moisture, setMoisture] = useState("");
  const [cost, setCost] = useState("");
  const [attempted, setAttempted] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      paddyService.recordDried(purchase.id, line.id, {
        dried_weight_kg: parseFloat(weight),
        dried_moisture_pct: parseFloat(moisture),
        drying_cost: cost ? parseFloat(cost) : null,
      }),
    onSuccess: () => {
      for (const key of [
        "palay-purchases",
        "palay-inventory",
        "inventory-summary",
        "record-history",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;
  const missingWeight = !(parseFloat(weight) > 0);
  const missingMoisture = !(parseFloat(moisture) >= 0);
  const valid = !missingWeight && !missingMoisture;
  const submit = () => {
    setAttempted(true);
    if (valid) save.mutate();
  };

  return (
    <RecordDialog
      title={t("Record drying of {{reference_no}}", { reference_no: purchase.reference_no })}
      subtitle={t("{{variety}}: {{wet}} kg wet, {{moisture}} moisture when bought.", {
        variety: line.variety_code ?? t("Any variety"),
        wet: kg(line.net_weight_kg),
        moisture: line.moisture_content_pct != null ? `${Number(line.moisture_content_pct)}%` : "—",
      })}
      onClose={onClose}
      busy={save.isPending}
      testId="record-drying"
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
          <button type="button" className="btn-primary" onClick={submit} disabled={save.isPending}>
            {save.isPending ? t("Saving…") : t("Mark as dry")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FieldCaption
            label={t("Weight after drying (kg)")}
            error={attempted && missingWeight ? needsInput() : undefined}
          >
            <input
              className="input"
              type="number"
              min={0}
              autoFocus
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </FieldCaption>
          <FieldCaption
            label={t("Moisture after drying %")}
            error={attempted && missingMoisture ? needsInput() : undefined}
          >
            <input
              className="input"
              type="number"
              min={0}
              value={moisture}
              onChange={(e) => setMoisture(e.target.value)}
            />
          </FieldCaption>
        </div>
        <FieldCaption label={t("What the drying cost (₱)")}>
          <input
            className="input"
            type="number"
            min={0}
            placeholder={t("Optional")}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </FieldCaption>
        <p className="text-sm text-secondary">
          {t("The palay in stock becomes this weight, and the line is marked dry and completed.")}
        </p>
        {attempted && !valid && (
          <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
            {fixFields()}
          </p>
        )}
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
