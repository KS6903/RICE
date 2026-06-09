import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X as XIcon, Trash2, RotateCcw, History, Star } from "lucide-react";
import { branchesService } from "../../services/BranchesService";

/* Bulk warehouse (branch) management: multi-select delete into a 30-day trash,
   plus restore. Mirrors the Settings → Branches controls so the Inventory
   warehouse tab offers the same actions. Backend enforces owner/admin + the
   "can't delete the main / last warehouse" rules. */
export default function ManageWarehousesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["branches"],
    queryFn: () => branchesService.list(),
  });
  const { data: trashed = [], isLoading: trashLoading } = useQuery<any[]>({
    queryKey: ["branches-trash"],
    queryFn: () => branchesService.listTrash(),
  });

  const selectable = branches.filter((b) => !b.is_main_branch);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["branches"] });
    qc.invalidateQueries({ queryKey: ["branches-trash"] });
    qc.invalidateQueries({ queryKey: ["activity"] });
  };

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => branchesService.bulkDelete(ids),
    onSuccess: (res: any) => {
      invalidateAll();
      setSelected(new Set());
      const skipped = res?.skipped ?? [];
      if (skipped.length) alert(skipped.map((s: any) => s.reason).join("\n"));
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => branchesService.restore(id),
    onSuccess: invalidateAll,
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === selectable.length ? new Set() : new Set(selectable.map((b) => b.id))
    );
  }
  function confirmDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (confirm(`Move ${ids.length} warehouse${ids.length === 1 ? "" : "s"} to trash? You can restore within 30 days.`)) {
      bulkDelete.mutate(ids);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="manage-wh-title"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[520px] max-h-[88vh] overflow-y-auto glass-strong rounded-2xl shadow-2xl ring-1 ring-soft p-5 animate-grad-fade-up">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 id="manage-wh-title" className="text-lg font-bold text-primary">Manage warehouses</h3>
            <p className="text-xs text-muted mt-0.5">Select warehouses to delete. Deleted ones stay recoverable for 30 days.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="btn-ghost !p-1.5"><XIcon size={16} /></button>
        </div>

        {/* Active warehouses */}
        <div className="rounded-xl ring-1 ring-soft overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-soft">
            <input
              type="checkbox"
              aria-label="Select all warehouses"
              className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer disabled:opacity-40"
              disabled={selectable.length === 0}
              checked={selectable.length > 0 && selected.size === selectable.length}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < selectable.length; }}
              onChange={toggleAll}
            />
            <span className="text-xs font-semibold text-secondary">{branches.length} warehouse{branches.length === 1 ? "" : "s"}</span>
            {selected.size > 0 && (
              <button onClick={confirmDelete} disabled={bulkDelete.isPending}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50">
                <Trash2 size={13} /> {bulkDelete.isPending ? "Deleting…" : `Delete ${selected.size}`}
              </button>
            )}
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {branches.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={`Select ${b.name}`}
                  className="h-4 w-4 rounded border-soft accent-rose-500 cursor-pointer disabled:opacity-30"
                  disabled={b.is_main_branch}
                  title={b.is_main_branch ? "The main warehouse can't be deleted" : undefined}
                  checked={selected.has(b.id)}
                  onChange={() => toggle(b.id)}
                />
                <span className="text-sm font-medium text-primary truncate">{b.name}</span>
                {b.is_main_branch && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                    <Star size={9} fill="currentColor" /> Main
                  </span>
                )}
              </li>
            ))}
            {branches.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted">No warehouses.</li>
            )}
          </ul>
        </div>

        {/* Trash */}
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <History size={15} className="text-muted" />
            <h4 className="text-sm font-semibold text-primary">Recently deleted</h4>
            <span className="text-xs text-muted">— kept 30 days, then removed for good</span>
          </div>
          {trashLoading ? (
            <p className="text-sm text-muted py-3 text-center">Loading…</p>
          ) : trashed.length === 0 ? (
            <p className="text-sm text-muted py-3 text-center">Trash is empty.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl ring-1 ring-soft px-3">
              {trashed.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{b.name}</p>
                    <p className="text-xs text-muted">
                      {b.deleted_by_name ? `Deleted by ${b.deleted_by_name} · ` : ""}
                      <span className={b.days_remaining <= 3 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""}>
                        {b.days_remaining}d left
                      </span>
                    </p>
                  </div>
                  <button onClick={() => restore.mutate(b.id)} disabled={restore.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-secondary text-sm font-semibold disabled:opacity-50">
                    <RotateCcw size={14} /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
