import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import api from "../services/api";

export interface QuickAddField {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  default?: string | number | boolean;
  full?: boolean;
}

interface QuickAddProps {
  label: string;
  endpoint: string;
  queryKey: (string | boolean)[];
  fields: QuickAddField[];
  transformBody?: (raw: Record<string, any>) => Record<string, any>;
  onCreated?: (created: any) => void;
}

export default function QuickAdd({
  label,
  endpoint,
  queryKey,
  fields,
  transformBody,
  onCreated,
}: QuickAddProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const initial = Object.fromEntries(
    fields.map((f) => [f.key, f.default ?? (f.type === "checkbox" ? false : "")]),
  );
  const [form, setForm] = useState<Record<string, any>>(initial);

  const create = useMutation({
    mutationFn: () => {
      const body = transformBody ? transformBody(form) : form;
      return api.post(endpoint, body).then((r) => r.data);
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey });
      setForm(initial);
      setOpen(false);
      if (onCreated) onCreated(created);
    },
  });

  const canSave =
    !create.isPending &&
    fields
      .filter((f) => f.required)
      .every((f) => {
        const v = form[f.key];
        return v !== undefined && v !== null && String(v).trim() !== "";
      });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium inline-flex items-center gap-0.5"
      >
        <Plus size={12} /> {label}
      </button>
    );
  }

  return (
    <div className="border border-brand-200 dark:border-brand-800 bg-brand-50/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-brand-900 dark:text-brand-200">{label}</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setForm(initial);
          }}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
        >
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {fields.map((f) => (
          <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-0.5">
              {f.label}
              {f.required && " *"}
            </label>
            {f.type === "select" ? (
              <select
                className="input text-sm py-1.5"
                value={form[f.key] || ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              >
                <option value="">Select…</option>
                {(f.options || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200 mt-1">
                <input
                  type="checkbox"
                  checked={!!form[f.key]}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.checked }))}
                />
                {f.placeholder || f.label}
              </label>
            ) : (
              <input
                type={f.type || "text"}
                className="input text-sm py-1.5"
                placeholder={f.placeholder}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      {create.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(create.error as any)?.response?.data?.detail || "Failed to add."}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setForm(initial);
          }}
          className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={!canSave}
          className="text-xs bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white font-medium px-3 py-1.5 rounded-md"
        >
          {create.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
