import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X as XIcon, Trash2, RotateCcw, History, Star, AlertTriangle } from "lucide-react";
import { canvaService } from "../../services/CanvaService";

type LayoutLite = { id: string; name: string; is_default: boolean };

function daysLabel(n: number) {
  if (n <= 0) return "expiring soon";
  return `${n}d left`;
}

export default function ManageLayoutsModal({
  layouts,
  activeBranchId,
  onClose,
}: {
  layouts: LayoutLite[];
  activeBranchId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: trashed = [], isLoading: trashLoading } = useQuery<any[]>({
    queryKey: ["layouts-trash", activeBranchId],
    queryFn: () => canvaService.listLayoutsTrash(activeBranchId),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["layouts", activeBranchId] });
    qc.invalidateQueries({ queryKey: ["layouts-trash", activeBranchId] });
  }

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) =>
      canvaService.bulkDeleteLayouts(ids),
    onSuccess: (res: any) => {
      setErrorMsg(null);
      invalidate();
      setSelected(new Set());
      const skipped: any[] = res?.skipped ?? [];
      if (skipped.length) {
        setErrorMsg(
          "Some layouts couldn't be moved to trash:\n" +
          skipped.map((s) => `• ${s.reason}`).join("\n")
        );
      }
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      setErrorMsg(
        typeof detail === "string"
          ? detail
          : err?.response?.status === 403
          ? "You don't have permission to delete layouts."
          : "Something went wrong. Check the server logs."
      );
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) =>
      canvaService.restoreLayout(id),
    onSuccess: () => { setErrorMsg(null); invalidate(); },
    onError: (err: any) => {
      setErrorMsg(err?.response?.data?.detail ?? "Couldn't restore layout.");
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === layouts.length ? new Set() : new Set(layouts.map((l) => l.id))
    );
  }
  function handleDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    setErrorMsg(null);
    bulkDelete.mutate(ids);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="manage-layouts-title"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <button type="button" aria-label="Close"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[480px] max-h-[88vh] flex flex-col glass-strong rounded-2xl shadow-2xl ring-1 ring-soft animate-grad-fade-up">

        {/* ── Static header ── */}
        <div className="shrink-0 rounded-t-2xl px-5 pt-5 pb-3 border-b border-soft">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 id="manage-layouts-title" className="text-lg font-bold text-primary">
                Select floor plans to delete
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Deleted layouts go to a 30-day trash. Zones and pallets are preserved until then.
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="btn-ghost !p-1.5">
              <XIcon size={16} />
            </button>
          </div>

          {/* Select-all + delete bar */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 ring-1 ring-soft">
            <input
              type="checkbox"
              aria-label="Select all layouts"
              className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer disabled:opacity-40"
              disabled={layouts.length === 0}
              checked={layouts.length > 0 && selected.size === layouts.length}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < layouts.length; }}
              onChange={toggleAll}
            />
            <span className="text-xs font-semibold text-secondary">
              {selected.size > 0
                ? `${selected.size} of ${layouts.length} selected`
                : `${layouts.length} layout${layouts.length === 1 ? "" : "s"}`}
            </span>
            {selected.size > 0 && (
              <button
                onClick={handleDelete}
                disabled={bulkDelete.isPending}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={13} />
                {bulkDelete.isPending ? "Moving to trash…" : `Move ${selected.size} to trash`}
              </button>
            )}
          </div>

          {/* Error display */}
          {errorMsg && (
            <div className="mt-2 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 rounded-lg px-2.5 py-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <p className="whitespace-pre-line">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto px-5 py-4 space-y-5">

          {/* Active layouts */}
          <div className="rounded-xl ring-1 ring-soft overflow-hidden">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {layouts.map((l) => (
                <li key={l.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${selected.has(l.id) ? "bg-rose-50/60 dark:bg-rose-950/20" : ""}`}
                  onClick={() => toggle(l.id)}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${l.name}`}
                    className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer pointer-events-none"
                    checked={selected.has(l.id)}
                    readOnly
                  />
                  <span className="text-sm font-medium text-primary truncate flex-1">{l.name}</span>
                  {l.is_default && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded shrink-0">
                      <Star size={9} fill="currentColor" /> Default
                    </span>
                  )}
                </li>
              ))}
              {layouts.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted">No layouts.</li>
              )}
            </ul>
          </div>

          {/* Trash section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <History size={14} className="text-muted" />
              <h4 className="text-sm font-semibold text-primary">Recently deleted</h4>
              <span className="text-xs text-muted ml-1">— kept for 30 days</span>
            </div>

            {trashLoading ? (
              <p className="text-sm text-muted py-3 text-center">Loading…</p>
            ) : trashed.length === 0 ? (
              <p className="text-sm text-muted py-3 text-center italic">Trash is empty.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl ring-1 ring-soft overflow-hidden">
                {trashed.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{l.name}</p>
                      <p className="text-xs text-muted">
                        {l.deleted_by_name ? `Deleted by ${l.deleted_by_name} · ` : ""}
                        <span className={l.days_remaining <= 3 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""}>
                          {daysLabel(l.days_remaining)}
                        </span>
                        <span className="ml-1 tabular-nums">· {l.width_m}m × {l.height_m}m</span>
                      </p>
                    </div>
                    <button
                      onClick={() => restore.mutate(l.id)}
                      disabled={restore.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-secondary text-xs font-semibold disabled:opacity-50 shrink-0"
                    >
                      <RotateCcw size={13} /> Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
