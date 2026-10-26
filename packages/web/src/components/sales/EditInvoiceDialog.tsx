import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import RecordDialog from "./RecordDialog";
import DatePicker from "../DatePicker";
import { salesService } from "../../services/SalesService";
import { t } from "../../i18n";

/** The Boss corrects a saved invoice's dates. Its amounts follow its order, so
 *  the note says where to change them. Every change is logged. */
export default function EditInvoiceDialog({
  invoice,
  onClose,
}: {
  invoice: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [invoiceDate, setInvoiceDate] = useState<string>(invoice.invoice_date ?? "");
  const [dueDate, setDueDate] = useState<string>(invoice.due_date ?? "");
  const save = useMutation({
    mutationFn: () =>
      salesService.editInvoice(invoice.id, {
        invoice_date: invoiceDate,
        due_date: dueDate || null,
      }),
    onSuccess: () => {
      for (const key of ["invoices", "record-history"]) qc.invalidateQueries({ queryKey: [key] });
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;

  return (
    <RecordDialog
      title={t("Edit invoice {{invoice_no}}", { invoice_no: invoice.invoice_no })}
      subtitle={t("Every change you save is logged in the invoice's history.")}
      onClose={onClose}
      busy={save.isPending}
      testId="edit-invoice"
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
            disabled={!invoiceDate || save.isPending}
          >
            {save.isPending ? t("Saving…") : t("Save changes")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">
              {t("Invoice date")}
            </span>
            <DatePicker
              value={invoiceDate}
              onChange={setInvoiceDate}
              aria-label={t("Invoice date")}
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Due date")}</span>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              aria-label={t("Due date")}
              clearable
            />
          </label>
        </div>
        <p className="text-sm text-secondary">
          {t(
            "The amounts come from the order. To change them, edit the order: the invoice follows.",
          )}
        </p>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {typeof error === "string" ? error : t("Couldn't save. Check the dates and try again.")}
          </p>
        )}
      </div>
    </RecordDialog>
  );
}
