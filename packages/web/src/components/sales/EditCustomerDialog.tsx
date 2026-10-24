import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CUSTOMER_TYPES } from "@rice-mill/shared";
import RecordDialog from "./RecordDialog";
import Select from "../Select";
import { salesService } from "../../services/SalesService";

const FIELDS: { key: string; label: string; type?: "number"; full?: boolean }[] = [
  { key: "name", label: "Name", full: true },
  { key: "contact_person", label: "Contact person" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address", full: true },
  { key: "tin", label: "TIN" },
  { key: "credit_limit", label: "Credit limit (₱)", type: "number" },
  { key: "payment_terms_days", label: "Payment terms (days)", type: "number" },
];

/** Edit a customer's details. Every change is logged in its history. */
export default function EditCustomerDialog({
  customer,
  onClose,
}: {
  customer: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(() => ({
    customer_type: customer.customer_type ?? "",
    ...Object.fromEntries(
      FIELDS.map((f) => [
        f.key,
        customer[f.key] === null || customer[f.key] === undefined
          ? ""
          : String(f.type === "number" ? Number(customer[f.key]) : customer[f.key]),
      ]),
    ),
  }));
  const save = useMutation({
    mutationFn: () =>
      salesService.updateCustomer(customer.id, {
        name: form.name.trim(),
        customer_type: form.customer_type || null,
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        tin: form.tin.trim() || null,
        credit_limit: parseFloat(form.credit_limit) || 0,
        payment_terms_days: parseInt(form.payment_terms_days) || 0,
      }),
    onSuccess: () => {
      for (const key of ["customers", "record-history"]) qc.invalidateQueries({ queryKey: [key] });
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;

  return (
    <RecordDialog
      title={`Edit ${customer.name}`}
      subtitle="Every change you save is logged in the customer's history."
      onClose={onClose}
      busy={save.isPending}
      testId="edit-customer"
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
            disabled={!form.name.trim() || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block mb-1 text-xs font-medium text-secondary">Type</span>
          <Select
            aria-label="Customer type"
            value={form.customer_type}
            onChange={(v) => setForm((f) => ({ ...f, customer_type: v }))}
            options={CUSTOMER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className={f.full ? "block sm:col-span-2" : "block"}>
            <span className="block mb-1 text-xs font-medium text-secondary">{f.label}</span>
            <input
              className="input"
              type={f.type ?? "text"}
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="sm:col-span-2 text-sm text-rose-600 dark:text-rose-400">
            {typeof error === "string" ? error : "Couldn't save. Check the fields and try again."}
          </p>
        )}
      </div>
    </RecordDialog>
  );
}
