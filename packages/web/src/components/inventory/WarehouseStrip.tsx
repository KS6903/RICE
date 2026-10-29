// The warehouses of the branch the Inventory page is looking at: pick one to
// narrow the stock to it, and (for whoever may edit inventory) add another,
// rename one, or delete one that never held anything. Every branch has at
// least one, "Warehouse 1 - <branch name>", made with it.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X as XIcon } from "lucide-react";
import ConfirmDialog from "../ConfirmDialog";
import { warehousesService, type Warehouse } from "../../services/WarehousesService";
import { t } from "../../i18n";

type Props = {
  branchId: string;
  branchName: string;
  warehouses: Warehouse[];
  /** The warehouse the page is narrowed to; "" shows them all. */
  selectedId: string;
  onSelect: (warehouseId: string) => void;
  canManage: boolean;
};

const errorText = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

export default function WarehouseStrip({
  branchId,
  branchName,
  warehouses,
  selectedId,
  onSelect,
  canManage,
}: Props) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = warehouses.find((w) => w.id === selectedId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["warehouses"] });

  const add = useMutation({
    mutationFn: (name: string) => warehousesService.add(branchId, name),
    onSuccess: (created) => {
      refresh();
      setAdding(false);
      setNewName("");
      setError(null);
      onSelect(created.id);
    },
    onError: (e) => setError(errorText(e, t("Could not add the warehouse."))),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => warehousesService.rename(id, name),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["palay-inventory"] });
      qc.invalidateQueries({ queryKey: ["milled-rice"] });
      qc.invalidateQueries({ queryKey: ["byproducts"] });
      setRenaming(false);
      setError(null);
    },
    onError: (e) => setError(errorText(e, t("Rename failed."))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => warehousesService.remove(id),
    onSuccess: () => {
      refresh();
      setConfirmDelete(false);
      setError(null);
      onSelect("");
    },
    onError: (e) => {
      setConfirmDelete(false);
      setError(errorText(e, t("Could not delete the warehouse.")));
    },
  });

  return (
    <div
      data-testid="warehouse-strip"
      role="group"
      aria-label={t("Warehouses in {{branch}}", { branch: branchName })}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-medium text-secondary">
        {t("Warehouses in {{branch}}", { branch: branchName })}
      </span>
      <div className="seg">
        {[{ id: "", name: t("All warehouses") }, ...warehouses].map((w) => (
          <button
            key={w.id || "all"}
            type="button"
            aria-pressed={selectedId === w.id}
            onClick={() => onSelect(w.id)}
            className={`seg-btn ${selectedId === w.id ? "is-active" : ""}`}
          >
            {w.name}
          </button>
        ))}
      </div>

      {canManage && selected && !renaming && (
        <>
          <button
            type="button"
            title={t("Rename warehouse")}
            aria-label={t("Rename {{name}}", { name: selected.name })}
            onClick={() => {
              setRenaming(true);
              setRenameValue(selected.name);
            }}
            className="p-1.5 rounded-lg text-muted hover:text-primary"
          >
            <Pencil size={14} />
          </button>
          {warehouses.length > 1 && (
            <button
              type="button"
              title={t("Delete warehouse")}
              aria-label={t("Delete {{name}}", { name: selected.name })}
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg text-muted hover:text-rose-600"
            >
              <Trash2 size={14} />
            </button>
          )}
        </>
      )}

      {renaming && selected && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (renameValue.trim() && renameValue.trim() !== selected.name)
              rename.mutate({ id: selected.id, name: renameValue.trim() });
            else setRenaming(false);
          }}
          className="flex items-center gap-1.5"
        >
          <input
            autoFocus
            className="input !py-1 !px-2 text-sm"
            aria-label={t("Warehouse name")}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
          />
          <button
            type="submit"
            disabled={rename.isPending}
            className="p-1 text-emerald-600 dark:text-emerald-400"
            aria-label={t("Save name")}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="p-1 text-muted hover:text-primary"
            aria-label={t("Cancel rename")}
          >
            <XIcon size={14} />
          </button>
        </form>
      )}

      {canManage &&
        (adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(newName.trim());
            }}
            className="flex items-center gap-1.5"
          >
            <input
              autoFocus
              className="input !py-1 !px-2 text-sm"
              aria-label={t("Warehouse name")}
              placeholder={t("Warehouse {{number}} - {{branch}}", {
                number: warehouses.length + 1,
                branch: branchName,
              })}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            />
            <button
              type="submit"
              disabled={add.isPending}
              className="px-3 py-1 rounded-lg bg-grad-brand text-white text-xs font-semibold disabled:opacity-50"
            >
              {add.isPending ? t("Adding…") : t("Add")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewName("");
                setError(null);
              }}
              className="p-1 text-muted hover:text-primary"
              aria-label={t("Cancel")}
            >
              <XIcon size={14} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
          >
            <Plus size={13} /> {t("Add warehouse")}
          </button>
        ))}

      {error && (
        <p role="alert" className="basis-full text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmDelete}
        danger
        busy={remove.isPending}
        title={t("Delete {{name}}?", { name: selected?.name ?? "" })}
        confirmLabel={t("Delete warehouse")}
        onConfirm={() => selected && remove.mutate(selected.id)}
        onCancel={() => setConfirmDelete(false)}
      >
        {t("Only a warehouse that never held stock can be deleted.")}
      </ConfirmDialog>
    </div>
  );
}
