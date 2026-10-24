import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import RecordDialog from "./RecordDialog";
import DatePicker from "../DatePicker";
import { salesService } from "../../services/SalesService";

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
      title={`Edit invoice ${invoice.invoice_no}`}
      subtitle="Every change you save is logged in the invoice's history."
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
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={!invoiceDate || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">Invoice date</span>
            <DatePicker value={invoiceDate} onChange={setInvoiceDate} aria-label="Invoice date" />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">Due date</span>
            <DatePicker value={dueDate} onChange={setDueDate} aria-label="Due date" clearable />
          </label>
        </div>
        <p className="text-sm text-secondary">
          The amounts come from the order. To change them, edit the order: the invoice follows.
        </p>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {typeof error === "string" ? error : "Couldn't save. Check the dates and try again."}
          </p>
        )}
      </div>
    </RecordDialog>
  );
}
