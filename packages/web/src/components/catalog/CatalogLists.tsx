// The lists the Boss fills in once and the rest of the app picks from: rice
// varieties, by-products, the mill's machines and expense categories. Shown on
// the Stock > Catalog page (most used to be Settings tabs).
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { paddyService } from "../../services/PaddyService";
import { millingService } from "../../services/MillingService";
import { costsService } from "../../services/CostsService";
import { byproductKindService, type ByproductKind } from "../../services/ByproductKindService";
import { useByproductKinds } from "../../hooks/useByproductKinds";
import { varietiesOf, type VarietyKind } from "../../utils/varieties";
import Select from "../Select";
import ConfirmDialog from "../ConfirmDialog";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  History,
  Pencil,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import { t } from "../../i18n";

const LABEL = "block text-sm font-semibold text-secondary mb-1.5";
const TABLE_HEAD =
  "px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

type VarietyEdit = { id: string; code: string; name: string; category: string; recovery: string };

const VARIETY_CATEGORIES = [
  { value: "inbred", label: t("Inbred") },
  { value: "hybrid", label: t("Hybrid") },
  { value: "local", label: t("Local") },
];

function VarietyRow({
  v,
  onEdit,
  onToggle,
  busy,
}: {
  v: any;
  onEdit: () => void;
  onToggle: () => void;
  busy: boolean;
}) {
  return (
    <tr
      className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors ${
        !v.is_active ? "opacity-60" : ""
      }`}
    >
      <td className="px-4 py-3 font-mono text-xs text-secondary">{v.code}</td>
      <td className="px-4 py-3 font-semibold text-primary">{v.name}</td>
      <td className="px-4 py-3 capitalize text-secondary">{v.category || "—"}</td>
      <td className="px-4 py-3 text-secondary">
        {v.typical_recovery_pct ? `${v.typical_recovery_pct}%` : "—"}
      </td>
      <td className="px-4 py-3">
        {v.company_id ? (
          <span className="badge-green">{t("Custom")}</span>
        ) : (
          <span className="badge-gray">{t("Default")}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {v.is_active ? (
          <span className="badge-green">{t("Shown")}</span>
        ) : (
          <span className="badge-gray">{t("Hidden")}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-4">
          <button
            type="button"
            aria-label={t("Edit {{name}}", { name: v.name })}
            onClick={onEdit}
            className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
          >
            <Pencil size={12} />
            {t("Edit")}
          </button>
          <button
            type="button"
            aria-label={`${v.is_active ? t("Hide") : t("Unhide")} ${v.name}`}
            onClick={onToggle}
            disabled={busy}
            className={`text-xs font-semibold inline-flex items-center gap-1 ${
              v.is_active
                ? "text-rose-600 dark:text-rose-400 hover:text-rose-700"
                : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
            }`}
          >
            {v.is_active ? <EyeOff size={12} /> : <Eye size={12} />}
            {v.is_active ? t("Hide") : t("Unhide")}
          </button>
        </div>
      </td>
    </tr>
  );
}

function VarietyEditRow({
  edit,
  setEdit,
  onSave,
  onCancel,
  saving,
  error,
}: {
  edit: VarietyEdit;
  setEdit: (e: VarietyEdit) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <tr className="bg-slate-50/60 dark:bg-slate-800/30">
      <td className="px-4 py-2.5">
        <input
          className="input font-mono"
          aria-label={t("Variety code")}
          value={edit.code}
          onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })}
        />
      </td>
      <td className="px-4 py-2.5">
        <input
          className="input"
          aria-label={t("Variety name")}
          value={edit.name}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
        />
        {error && (
          <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>
        )}
      </td>
      <td className="px-4 py-2.5">
        <Select
          aria-label={t("Variety category")}
          value={edit.category}
          onChange={(v) => setEdit({ ...edit, category: v })}
          options={VARIETY_CATEGORIES}
        />
      </td>
      <td className="px-4 py-2.5">
        <input
          className="input"
          type="number"
          aria-label={t("Typical recovery %")}
          value={edit.recovery}
          onChange={(e) => setEdit({ ...edit, recovery: e.target.value })}
        />
      </td>
      <td className="px-4 py-2.5" colSpan={3}>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="btn-primary"
            disabled={saving || !edit.code.trim() || !edit.name.trim()}
          >
            {saving ? t("Saving…") : t("Save")}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function VarietiesList() {
  const qc = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // Palay and rice have their own lists; a new variety joins the one on screen.
  const [kind, setKind] = useState<VarietyKind>("palay");
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "inbred",
    typical_recovery_pct: "",
  });
  const [editing, setEditing] = useState<VarietyEdit | null>(null);

  const { data: everyVariety = [] } = useQuery({
    queryKey: ["varieties-all"],
    queryFn: () => paddyService.listVarieties(true),
  });
  const varieties = varietiesOf(everyVariety, kind);
  const shown = varieties.filter((v: any) => v.is_active);
  const hidden = varieties.filter((v: any) => !v.is_active);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["varieties-all"] });
    qc.invalidateQueries({ queryKey: ["varieties"] });
  };

  const create = useMutation({
    mutationFn: (b: typeof form) =>
      paddyService.createVariety({
        ...b,
        kind,
        typical_recovery_pct: b.typical_recovery_pct ? parseFloat(b.typical_recovery_pct) : null,
      }),
    onSuccess: () => {
      refresh();
      setShowForm(false);
      setForm({ code: "", name: "", category: "inbred", typical_recovery_pct: "" });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      paddyService.updateVariety(id, { is_active }),
    onSuccess: refresh,
  });

  const save = useMutation({
    mutationFn: (e: VarietyEdit) =>
      paddyService.updateVariety(e.id, {
        code: e.code.trim(),
        name: e.name.trim(),
        category: e.category,
        ...(e.recovery !== "" ? { typical_recovery_pct: parseFloat(e.recovery) } : {}),
      }),
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
  });

  const startEdit = (v: any) => {
    save.reset();
    setEditing({
      id: v.id,
      code: v.code ?? "",
      name: v.name ?? "",
      category: v.category || "inbred",
      recovery: v.typical_recovery_pct != null ? String(Number(v.typical_recovery_pct)) : "",
    });
  };

  const rows = (list: any[]) =>
    list.map((v: any) =>
      editing && editing.id === v.id ? (
        <VarietyEditRow
          key={v.id}
          edit={editing}
          setEdit={setEditing}
          onSave={() => save.mutate(editing)}
          onCancel={() => setEditing(null)}
          saving={save.isPending}
          error={
            save.isError
              ? (save.error as any)?.response?.data?.detail || t("Couldn't save the variety.")
              : null
          }
        />
      ) : (
        <VarietyRow
          key={v.id}
          v={v}
          onEdit={() => startEdit(v)}
          onToggle={() => toggle.mutate({ id: v.id, is_active: !v.is_active })}
          busy={toggle.isPending}
        />
      ),
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        {t(
          "Palay and rice have their own lists. Add your own varieties, or edit the default ones (NSIC Rc 222 and the rest for palay, Dinorado and the rest for rice). Hide a variety you don't use: it leaves the lists you pick from until you unhide it.",
        )}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={t("Variety list")} className="flex gap-2">
          {(
            [
              ["palay", t("Palay")],
              ["rice", t("Rice")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setEditing(null);
              }}
              className={kind === value ? "btn-primary" : "btn-secondary"}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> {t("Add variety")}
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">{t("New variety")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{t("Code *")}</label>
              <input
                className="input"
                placeholder={kind === "palay" ? t("e.g. NSIC Rc 222") : t("e.g. Dinorado")}
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <label className={LABEL}>{t("Name *")}</label>
              <input
                className="input"
                placeholder={
                  kind === "palay" ? t("e.g. NSIC Rc 222 (Tubigan 18)") : t("e.g. Dinorado")
                }
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>{t("Category")}</label>
              <Select
                aria-label={t("Category")}
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                options={VARIETY_CATEGORIES}
              />
            </div>
            <div>
              <label className={LABEL}>{t("Typical recovery %")}</label>
              <input
                className="input"
                type="number"
                placeholder="65"
                value={form.typical_recovery_pct}
                onChange={(e) => setForm((f) => ({ ...f, typical_recovery_pct: e.target.value }))}
              />
            </div>
          </div>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || t("Failed to add variety.")}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.code || !form.name}
            >
              {create.isPending ? t("Saving…") : t("Save variety")}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              {[
                t("Code"),
                t("Name"),
                t("Category"),
                t("Recovery %"),
                t("Source"),
                t("Status"),
                "",
              ].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {rows(shown)}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted font-medium">
                  {t("No varieties shown")}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {hidden.length > 0 && (
          <div className="border-t border-soft bg-slate-50/40 dark:bg-slate-800/30">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-secondary hover:text-primary hover:bg-slate-100/50 dark:hover:bg-slate-600/15 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <EyeOff size={14} />
                {t("Hidden varieties ({{hiddenCount}})", { hiddenCount: hidden.length })}
              </span>
              {showHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHidden && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
                  {rows(hidden)}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EquipmentRow({ e, onToggle }: { e: any; onToggle: () => void }) {
  return (
    <tr
      className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors ${
        !e.is_active ? "opacity-60" : ""
      }`}
    >
      <td className="px-4 py-3 font-semibold text-primary">{e.name}</td>
      <td className="px-4 py-3 text-secondary">{e.model || "—"}</td>
      <td className="px-4 py-3 text-secondary">
        {e.capacity_kg_per_hr ? `${e.capacity_kg_per_hr} kg/hr` : "—"}
      </td>
      <td className="px-4 py-3">
        {e.is_active ? (
          <span className="badge-green">{t("Active")}</span>
        ) : (
          <span className="badge-red">{t("Inactive")}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onToggle}
          className={`text-xs font-semibold inline-flex items-center gap-1 ${
            e.is_active
              ? "text-rose-600 dark:text-rose-400 hover:text-rose-700"
              : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
          }`}
        >
          <Power size={12} />
          {e.is_active ? t("Deactivate") : t("Activate")}
        </button>
      </td>
    </tr>
  );
}

export function MachinesList() {
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", model: "", capacity_kg_per_hr: "" });

  const { data: equipment = [] } = useQuery({
    queryKey: ["equipment-all"],
    queryFn: () => millingService.listEquipment(true),
  });
  const active = equipment.filter((e: any) => e.is_active);
  const inactive = equipment.filter((e: any) => !e.is_active);

  const create = useMutation({
    mutationFn: (b: typeof form) =>
      millingService.createEquipment({
        ...b,
        capacity_kg_per_hr: b.capacity_kg_per_hr ? parseFloat(b.capacity_kg_per_hr) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-all"] });
      qc.invalidateQueries({ queryKey: ["equipment"] });
      setShowForm(false);
      setForm({ name: "", model: "", capacity_kg_per_hr: "" });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      millingService.updateEquipment(id, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["equipment-all"] });
      qc.invalidateQueries({ queryKey: ["equipment"] });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        {t("Add and manage milling equipment for your company.")}
      </p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> {t("Add equipment")}
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">{t("New equipment")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={LABEL}>{t("Name *")}</label>
              <input
                className="input"
                placeholder={t("e.g. Mill #1")}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>{t("Model")}</label>
              <input
                className="input"
                placeholder={t("e.g. SB-30")}
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL}>{t("Capacity (kg/hr)")}</label>
              <input
                className="input"
                type="number"
                placeholder="500"
                value={form.capacity_kg_per_hr}
                onChange={(e) => setForm((f) => ({ ...f, capacity_kg_per_hr: e.target.value }))}
              />
            </div>
          </div>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || t("Failed to add equipment.")}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.name}
            >
              {create.isPending ? t("Saving…") : t("Save equipment")}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              {[t("Name"), t("Model"), t("Capacity"), t("Status"), ""].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {active.map((e: any) => (
              <EquipmentRow
                key={e.id}
                e={e}
                onToggle={() => toggle.mutate({ id: e.id, is_active: false })}
              />
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted font-medium">
                  {t("No active equipment")}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <div className="border-t border-soft bg-slate-50/40 dark:bg-slate-800/30">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-secondary hover:text-primary hover:bg-slate-100/50 dark:hover:bg-slate-600/15 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <History size={14} />
                {t("Deactivated history ({{inactiveCount}})", { inactiveCount: inactive.length })}
              </span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showHistory && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
                  {inactive.map((e: any) => (
                    <EquipmentRow
                      key={e.id}
                      e={e}
                      onToggle={() => toggle.mutate({ id: e.id, is_active: true })}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type CategoryEdit = { id: string; name: string; is_production_cost: boolean };

const CATEGORY_TYPES = [
  { value: "production", label: t("Production") },
  { value: "overhead", label: t("Overhead") },
];

export function ExpenseCategoriesList() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", is_production_cost: true });
  const [editing, setEditing] = useState<CategoryEdit | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => costsService.listCategories(),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["expense-categories"] });

  const create = useMutation({
    mutationFn: (b: typeof form) => costsService.createCategory(b),
    onSuccess: () => {
      refresh();
      setShowForm(false);
      setForm({ name: "", is_production_cost: true });
    },
  });

  const save = useMutation({
    mutationFn: (e: CategoryEdit) =>
      costsService.updateCategory(e.id, { name: e.name, is_production_cost: e.is_production_cost }),
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) =>
      costsService.deleteCategory(id, moveTo),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setDeleting(null);
    },
  });

  const startEdit = (c: any) => {
    save.reset();
    setEditing({ id: c.id, name: c.name, is_production_cost: c.is_production_cost });
  };

  const startDelete = (c: any) => {
    remove.reset();
    const others = categories.filter((o: any) => o.id !== c.id);
    // Default categories first: they're the ones that never go away.
    const target = others.find((o: any) => o.is_default) ?? others[0];
    setMoveTo(target?.id ?? "");
    setDeleting(c);
  };

  const inUse: number = deleting?.expense_count ?? 0;
  const moveOptions = categories
    .filter((o: any) => o.id !== deleting?.id)
    .map((o: any) => ({ value: o.id, label: o.name }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        {t(
          "Categorize your expenses (Fuel, Electricity, Labor, etc.). The default categories can be renamed or switched between production and overhead, but they can't be deleted. Categories you add can be deleted.",
        )}
      </p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> {t("Add category")}
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">{t("New expense category")}</h3>
          <div>
            <label className={LABEL}>{t("Category name *")}</label>
            <input
              className="input"
              placeholder={t("e.g. Rice hull hauling")}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm font-medium text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-soft accent-emerald-500 cursor-pointer"
              checked={form.is_production_cost}
              onChange={(e) => setForm((f) => ({ ...f, is_production_cost: e.target.checked }))}
            />
            <span>{t("Production cost (vs. overhead)")}</span>
          </label>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {(create.error as any)?.response?.data?.detail || t("Failed to add category.")}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button
              onClick={() => create.mutate(form)}
              className="btn-primary"
              disabled={create.isPending || !form.name.trim()}
            >
              {create.isPending ? t("Saving…") : t("Save category")}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              {[t("Name"), t("Type"), t("Source"), ""].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {categories.map((c: any) =>
              editing && editing.id === c.id ? (
                <tr key={c.id} className="bg-slate-50/60 dark:bg-slate-800/30">
                  <td className="px-4 py-2.5">
                    <input
                      className="input"
                      aria-label={t("Category name")}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                    {save.isError && (
                      <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                        {(save.error as any)?.response?.data?.detail ||
                          t("Couldn't save the category.")}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      aria-label={t("Category type")}
                      value={editing.is_production_cost ? "production" : "overhead"}
                      onChange={(v) =>
                        setEditing({ ...editing, is_production_cost: v === "production" })
                      }
                      options={CATEGORY_TYPES}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <CategorySource c={c} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="btn-secondary"
                      >
                        {t("Cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => save.mutate({ ...editing, name: editing.name.trim() })}
                        className="btn-primary"
                        disabled={save.isPending || !editing.name.trim()}
                      >
                        {save.isPending ? t("Saving…") : t("Save")}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={c.id}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors"
                >
                  <td className="px-4 py-3 font-semibold text-primary">{c.name}</td>
                  <td className="px-4 py-3">
                    {c.is_production_cost ? (
                      <span className="badge-green">{t("Production")}</span>
                    ) : (
                      <span className="badge-gray">{t("Overhead")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <CategorySource c={c} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-4">
                      <button
                        type="button"
                        aria-label={t("Edit {{name}}", { name: c.name })}
                        onClick={() => startEdit(c)}
                        className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
                      >
                        <Pencil size={12} />
                        {t("Edit")}
                      </button>
                      {!c.is_default && (
                        <button
                          type="button"
                          aria-label={t("Delete {{name}}", { name: c.name })}
                          onClick={() => startDelete(c)}
                          className="text-xs font-semibold inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700"
                        >
                          <Trash2 size={12} />
                          {t("Delete")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ),
            )}
            {categories.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted font-medium">
                  {t("No categories")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleting}
        danger
        busy={remove.isPending || (inUse > 0 && !moveTo)}
        title={`Delete ${deleting?.name ?? "category"}?`}
        confirmLabel={inUse > 0 ? t("Move and delete") : t("Delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => remove.mutate({ id: deleting.id, moveTo: inUse > 0 ? moveTo : undefined })}
      >
        <div className="space-y-2">
          {inUse > 0 ? (
            <>
              <p>
                {t("{{count}} expenses are filed under it. Choose where they go:", {
                  count: inUse,
                })}
              </p>
              <Select
                aria-label={t("Move its expenses to")}
                value={moveTo}
                onChange={setMoveTo}
                options={moveOptions}
              />
            </>
          ) : (
            <p>{t("No expense is filed under it.")}</p>
          )}
          {remove.isError && (
            <p className="font-medium text-rose-600 dark:text-rose-400">
              {(remove.error as any)?.response?.data?.detail || t("Couldn't delete the category.")}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}

function CategorySource({ c }: { c: any }) {
  return c.is_default ? (
    <span className="badge-gray">{t("Default")}</span>
  ) : (
    <span className="badge-green">{t("Custom")}</span>
  );
}

type ByproductEdit = { id: string; name: string };

const errorText = (error: unknown, fallback: string): string =>
  (error as any)?.response?.data?.detail || fallback;

export function ByproductsList() {
  const qc = useQueryClient();
  const { all: kinds } = useByproductKinds();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<ByproductEdit | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["byproduct-kinds"] });

  const create = useMutation({
    mutationFn: (n: string) => byproductKindService.create(n),
    onSuccess: () => {
      refresh();
      setShowForm(false);
      setName("");
    },
  });
  const save = useMutation({
    mutationFn: (e: ByproductEdit) => byproductKindService.update(e.id, { name: e.name }),
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
  });
  const toggle = useMutation({
    mutationFn: (k: ByproductKind) =>
      byproductKindService.update(k.id as string, { is_active: !k.is_active }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        {t(
          "Ipa, darak and binlid come with every mill, and milling counts them, so they stay. Add the other by-products you buy, keep or sell. Renaming one keeps its stock and records; hiding one takes it out of the pickers.",
        )}
      </p>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <Plus size={16} /> {t("Add by-product")}
        </button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-primary">{t("New by-product")}</h3>
          <div>
            <label className={LABEL} htmlFor="new-byproduct">
              {t("Name *")}
            </label>
            <input
              id="new-byproduct"
              className="input"
              placeholder={t("e.g. Carbonized rice hull")}
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {create.isError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {errorText(create.error, t("Couldn't add the by-product."))}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              {t("Cancel")}
            </button>
            <button
              onClick={() => create.mutate(name.trim())}
              className="btn-primary"
              disabled={create.isPending || !name.trim()}
            >
              {create.isPending ? t("Saving…") : t("Save by-product")}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-emerald-50/80 via-cyan-50/60 to-violet-50/80 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-violet-900/20 border-b border-soft">
            <tr>
              {[t("Name"), t("Source"), t("Status"), ""].map((h) => (
                <th key={h} className={TABLE_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {kinds.map((k) =>
              editing && editing.id === k.id ? (
                <tr key={k.code} className="bg-slate-50/60 dark:bg-slate-800/30">
                  <td className="px-4 py-2.5" colSpan={3}>
                    <input
                      className="input"
                      aria-label={t("By-product name")}
                      maxLength={50}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                    {save.isError && (
                      <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                        {errorText(save.error, t("Couldn't save the by-product."))}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="btn-secondary"
                      >
                        {t("Cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => save.mutate({ ...editing, name: editing.name.trim() })}
                        className="btn-primary"
                        disabled={save.isPending || !editing.name.trim()}
                      >
                        {save.isPending ? t("Saving…") : t("Save")}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={k.code}
                  className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/15 transition-colors ${
                    !k.is_active ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-semibold text-primary">{k.name}</td>
                  <td className="px-4 py-3">
                    {k.built_in ? (
                      <span className="badge-gray">{t("Default")}</span>
                    ) : (
                      <span className="badge-green">{t("Custom")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {k.is_active ? (
                      <span className="badge-green">{t("Shown")}</span>
                    ) : (
                      <span className="badge-gray">{t("Hidden")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {k.id && (
                      <div className="flex justify-end gap-4">
                        <button
                          type="button"
                          aria-label={t("Edit {{name}}", { name: k.name })}
                          onClick={() => {
                            save.reset();
                            setEditing({ id: k.id as string, name: k.name });
                          }}
                          className="text-xs font-semibold inline-flex items-center gap-1 text-secondary hover:text-primary"
                        >
                          <Pencil size={12} />
                          {t("Edit")}
                        </button>
                        <button
                          type="button"
                          aria-label={`${k.is_active ? t("Hide") : t("Unhide")} ${k.name}`}
                          onClick={() => toggle.mutate(k)}
                          disabled={toggle.isPending}
                          className={`text-xs font-semibold inline-flex items-center gap-1 ${
                            k.is_active
                              ? "text-rose-600 dark:text-rose-400 hover:text-rose-700"
                              : "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
                          }`}
                        >
                          {k.is_active ? <EyeOff size={12} /> : <Eye size={12} />}
                          {k.is_active ? t("Hide") : t("Unhide")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
