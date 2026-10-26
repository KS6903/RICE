// Correcting a saved expense (edit power): every changed field goes in the
// expense's history.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import RecordDialog from "../sales/RecordDialog";
import Select from "../Select";
import DatePicker from "../DatePicker";
import { costsService } from "../../services/CostsService";
import { t } from "../../i18n";

export default function EditExpenseDialog({
  expense,
  categories,
  batches,
  onClose,
}: {
  expense: any;
  categories: { id: string; name: string }[];
  /** The milling batches it can be linked to; empty without milling. */
  batches: { id: string; batch_no: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [categoryId, setCategoryId] = useState<string>(expense.category_id ?? "");
  const [date, setDate] = useState<string>(expense.expense_date ?? "");
  const [amount, setAmount] = useState<string>(String(Number(expense.amount ?? 0)));
  const [batchId, setBatchId] = useState<string>(expense.batch_id ?? "");
  const [description, setDescription] = useState<string>(expense.description ?? "");
  const [referenceNo, setReferenceNo] = useState<string>(expense.reference_no ?? "");

  const valid = !!categoryId && !!date && amount !== "" && !Number.isNaN(Number(amount));

  const save = useMutation({
    mutationFn: () =>
      costsService.editExpense(expense.id, {
        category_id: categoryId,
        batch_id: batchId || null,
        expense_date: date,
        amount: Number(amount),
        description: description.trim() || null,
        reference_no: referenceNo.trim() || null,
      }),
    onSuccess: () => {
      for (const key of ["expenses", "record-history"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;

  const batchOptions = [
    { value: "", label: t("No batch") },
    ...batches.map((b) => ({ value: b.id, label: b.batch_no })),
  ];
  if (batchId && !batches.some((b) => b.id === batchId))
    batchOptions.push({ value: batchId, label: "This batch" });

  return (
    <RecordDialog
      title={t("Edit expense")}
      subtitle={t("Every change you save is logged in the expense's history.")}
      onClose={onClose}
      busy={save.isPending}
      testId="edit-expense"
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
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Category")}</span>
            <Select
              aria-label={t("Category")}
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Date")}</span>
            <DatePicker value={date} onChange={setDate} aria-label={t("Expense date")} />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Amount (₱)")}</span>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              aria-label={t("Amount")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {batches.length > 0 || batchId ? (
            <label className="block">
              <span className="block mb-1 text-xs font-medium text-secondary">{t("Batch")}</span>
              <Select
                aria-label={t("Batch")}
                value={batchId}
                onChange={setBatchId}
                options={batchOptions}
              />
            </label>
          ) : null}
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">
              {t("Reference no.")}
            </span>
            <input
              className="input"
              maxLength={50}
              aria-label={t("Reference no.")}
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="block mb-1 text-xs font-medium text-secondary">{t("Description")}</span>
          <textarea
            className="input min-h-[4rem]"
            aria-label={t("Description")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
