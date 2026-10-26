import { useId, useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import api from "../services/api";
import Select from "./Select";

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

const FIELD_LABEL = "block text-xs font-bold uppercase tracking-wider text-muted mb-1";

/**
 * A small "add one" form behind a link, e.g. "+ New customer" beside a picker.
 * It opens as a dialog rather than unfolding in place: the link usually sits in
 * a narrow label row, where an inline form had no room.
 *
 * Rendered into <body>: the page's content wrapper is animated, and a
 * transformed ancestor would trap a `fixed` backdrop inside it.
 */
export default function QuickAdd({
  label,
  endpoint,
  queryKey,
  fields,
  transformBody,
  onCreated,
}: QuickAddProps) {
  const qc = useQueryClient();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [open, setOpen] = useState(false);
  const initial = Object.fromEntries(
    fields.map((f) => [f.key, f.default ?? (f.type === "checkbox" ? false : "")]),
  );
  const [form, setForm] = useState<Record<string, any>>(initial);

  const close = () => {
    setOpen(false);
    setForm(initial);
  };

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

  // Escape closes the dialog (a dropdown menu that is open keeps its own Escape).
  useEscapeKey(close, open);

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium inline-flex items-center gap-0.5"
    >
      <Plus size={12} /> {label}
    </button>
  );

  if (!open) return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        <div
          className="dialog-viewport fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-title`}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
            onClick={close}
          />
          <form
            data-testid="quick-add-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) create.mutate();
            }}
            className="dialog-panel relative w-full max-w-lg overflow-y-auto glass-strong rounded-2xl shadow-2xl ring-1 ring-soft p-5 animate-grad-fade-up"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 id={`${uid}-title`} className="text-lg font-bold text-primary">
                {label}
              </h3>
              <button type="button" aria-label="Close" onClick={close} className="btn-ghost !p-1.5">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map((f, idx) => {
                const id = `${uid}-${f.key}`;
                return (
                  <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
                    {f.type !== "checkbox" && (
                      <label htmlFor={id} className={FIELD_LABEL}>
                        {f.label}
                        {f.required && " *"}
                      </label>
                    )}
                    {f.type === "select" ? (
                      <Select
                        id={id}
                        placeholder="Select…"
                        value={String(form[f.key] ?? "")}
                        onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
                        options={f.options ?? []}
                      />
                    ) : f.type === "checkbox" ? (
                      <label
                        htmlFor={id}
                        className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200 mt-1"
                      >
                        <input
                          id={id}
                          type="checkbox"
                          checked={!!form[f.key]}
                          onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.checked }))}
                        />
                        {f.placeholder || f.label}
                      </label>
                    ) : (
                      <input
                        id={id}
                        type={f.type || "text"}
                        className="input"
                        placeholder={f.placeholder}
                        value={form[f.key] ?? ""}
                        // The first field is what you came to fill in.
                        autoFocus={idx === 0}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {create.isError && (
              <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
                {(create.error as any)?.response?.data?.detail || "Failed to add."}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={!canSave} className="btn-primary">
                {create.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
