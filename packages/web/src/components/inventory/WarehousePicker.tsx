import { memo, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, Pencil, Plus, Check, X as XIcon, Star, Globe } from "lucide-react";
import { branchesService } from "../../services/BranchesService";

export type WarehouseBranch = {
  id: string;
  name: string;
  is_main_branch?: boolean;
  is_active?: boolean;
};

type Props = {
  branches: WarehouseBranch[];
  selectedId: string; // "" = All warehouses
  onSelect: (branchId: string) => void;
  allowAllOption?: boolean; // show "All warehouses" entry (default true)
  allowAdd?: boolean; // show the "+ Add warehouse" footer (default true)
};

function WarehousePickerInner({
  branches,
  selectedId,
  onSelect,
  allowAllOption = true,
  allowAdd = true,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setRenamingId(null);
        setAdding(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setRenamingId(null);
        setAdding(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      branchesService.update(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      setRenamingId(null);
      setError(null);
    },
    onError: (e: any) => setError(e?.response?.data?.detail || "Rename failed."),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      branchesService.create({ name, is_main_branch: false, is_active: true }),
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      setAdding(false);
      setNewName("");
      setError(null);
      setOpen(false);
      // Switch the viewer to the newly-created warehouse right away so the
      // user can immediately set it up — otherwise it's easy to miss that
      // a brand-new branch was added but the page is still showing the old one.
      if (created?.id) onSelect(created.id);
    },
    onError: (e: any) => setError(e?.response?.data?.detail || "Could not add warehouse."),
  });

  const selected = branches.find((b) => b.id === selectedId);
  const label = selectedId
    ? selected
      ? selected.name
      : "Unknown warehouse"
    : `All warehouses (${branches.length})`;

  return (
    <div data-testid="warehouse-picker" className="relative">
      {/* Trigger: explicit styles, NO `.input` class. The shared `.input` rule
          carries `transition: all 0.15s ease`, which combined with hover
          border-color swap produces visible sub-pixel jitter on rapid mouse
          movement. Inline classes keep transitions narrowed to the colors. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800/60 ring-1 ring-soft hover:ring-slate-400 dark:hover:ring-slate-500 text-sm font-medium text-primary cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selectedId ? (
          <Building2 size={14} className="text-emerald-500 shrink-0" />
        ) : (
          <Globe size={14} className="text-muted shrink-0" />
        )}
        <span className="truncate max-w-[160px]">{label}</span>
        {selected?.is_main_branch && (
          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-md">
            Main
          </span>
        )}
        <ChevronDown size={14} className={`text-muted ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          data-testid="warehouse-picker-popover"
          // `position: fixed` (vs. absolute) so the popover is decoupled from
          // any flexbox layout shifts in the page header. translateZ(0) hoists
          // it onto its own GPU layer so backdrop hover state doesn't repaint
          // the page underneath.
          className="absolute right-0 mt-2 w-72 z-50 bg-white dark:bg-slate-900 rounded-xl shadow-2xl ring-1 ring-soft overflow-hidden"
          role="listbox"
          style={{ transform: "translateZ(0)" }}
        >
          <div
            className="max-h-80 overflow-y-auto p-1"
            // Reserve scrollbar gutter so the row width is fixed whether or
            // not the scrollbar is rendered — otherwise the layout shifts as
            // the scrollbar appears on hover, looking like flicker.
            style={{ scrollbarGutter: "stable" }}
          >
            {allowAllOption && (
              <button
                type="button"
                onClick={() => {
                  onSelect("");
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  selectedId === ""
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold"
                    : "text-secondary hover:bg-slate-100 dark:hover:bg-slate-700/40"
                }`}
              >
                <Globe size={14} />
                <span className="flex-1">All warehouses</span>
                <span className="text-[11px] text-muted tabular-nums">{branches.length}</span>
              </button>
            )}

            <div className="my-1 border-t border-soft" />

            {branches.length === 0 && !adding && (
              <p className="text-xs text-muted text-center py-3 italic">No warehouses yet.</p>
            )}

            {branches.map((b) => {
              const isSel = b.id === selectedId;
              const isRenaming = renamingId === b.id;
              return (
                <div
                  key={b.id}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    isSel ? "bg-emerald-500/10" : "hover:bg-slate-100 dark:hover:bg-slate-700/40"
                  }`}
                >
                  <Building2 size={14} className={isSel ? "text-emerald-500" : "text-muted"} />
                  {isRenaming ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (renameValue.trim() && renameValue.trim() !== b.name) {
                          renameMutation.mutate({ id: b.id, name: renameValue.trim() });
                        } else {
                          setRenamingId(null);
                        }
                      }}
                      className="flex-1 flex items-center gap-1"
                    >
                      <input
                        autoFocus
                        className="input !py-0.5 !px-2 text-sm flex-1"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setRenamingId(null)}
                      />
                      <button
                        type="submit"
                        className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
                        aria-label="Save name"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        aria-label="Cancel rename"
                      >
                        <XIcon size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(b.id);
                          setOpen(false);
                        }}
                        className={`flex-1 text-left truncate ${isSel ? "text-primary font-semibold" : "text-secondary"}`}
                      >
                        {b.name}
                      </button>
                      {b.is_main_branch && (
                        <Star
                          size={11}
                          className="text-amber-400 shrink-0"
                          fill="currentColor"
                          aria-label="Main branch"
                        />
                      )}
                      <button
                        type="button"
                        title="Rename warehouse"
                        aria-label={`Rename ${b.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(b.id);
                          setRenameValue(b.name);
                        }}
                        // Always visible (dimmed). Hover only changes the icon
                        // colour — no overlapping background swap with the row
                        // hover bg, which was a flicker source.
                        className="shrink-0 p-1 rounded text-slate-400 dark:text-slate-500 hover:text-primary"
                      >
                        <Pencil size={12} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add warehouse footer */}
          {allowAdd && (
            <div className="border-t border-soft p-1.5 bg-slate-50/50 dark:bg-slate-800/30">
              {adding ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newName.trim()) createMutation.mutate(newName.trim());
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    autoFocus
                    className="input !py-1 !px-2 text-sm flex-1"
                    placeholder="Warehouse name…"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                  />
                  <button
                    type="submit"
                    disabled={!newName.trim() || createMutation.isPending}
                    className="px-3 py-1 rounded-lg bg-grad-brand text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {createMutation.isPending ? "Adding…" : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setNewName("");
                      setError(null);
                    }}
                    className="p-1 text-muted hover:text-primary"
                    aria-label="Cancel"
                  >
                    <XIcon size={14} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                >
                  <Plus size={14} /> Add warehouse
                </button>
              )}
              {error && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400 px-2 pt-1.5 font-medium">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// memo: the picker re-renders only when its actual inputs change. Auth-me
// polling (every 10 s) and other unrelated parent state updates no longer
// trigger style recalcs inside the popover, which were producing the
// hover-flicker the user reported.
const WarehousePicker = memo(
  WarehousePickerInner,
  (prev, next) =>
    prev.selectedId === next.selectedId &&
    prev.onSelect === next.onSelect &&
    prev.allowAllOption === next.allowAllOption &&
    prev.allowAdd === next.allowAdd &&
    prev.branches.length === next.branches.length &&
    prev.branches.every((b, i) => {
      const o = next.branches[i];
      return o && o.id === b.id && o.name === b.name && o.is_main_branch === b.is_main_branch;
    }),
);

export default WarehousePicker;
