import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wheat, Package, Boxes, X as XIcon, Plus, Check } from "lucide-react";
import { paddyService } from "../../services/PaddyService";
import { branchesService } from "../../services/BranchesService";
import { inventoryService } from "../../services/InventoryService";
import { allUnits, saveCustomUnit, type QuantityUnit, slugify } from "./inventoryExtras";

type StockType = "palay" | "milled_rice" | "byproduct";

const BUILTIN_TABS: { key: StockType; label: string; icon: React.ElementType }[] = [
  { key: "palay",       label: "Palay",       icon: Wheat },
  { key: "milled_rice", label: "Milled Rice", icon: Package },
  { key: "byproduct",   label: "By-product",  icon: Boxes },
];

const MILLED_GRADES = ["premium", "regular", "broken"];

const DEFAULT_BYPRODUCTS: { value: string; label: string }[] = [
  { value: "ipa",    label: "Ipa (Rice Hull)" },
  { value: "darak",  label: "Darak (Rice Bran)" },
  { value: "binlid", label: "Binlid (Broken Rice)" },
];

/* ── Inline "pick or create" select ──────────────────────────────────────────
   A dropdown with a "+ New" affordance. onCreate does the actual work (API call
   or local add) and resolves with nothing; the parent selects the new value. */
function InlineCreateSelect({
  label, value, onChange, options, placeholder, newPlaceholder, onCreate, optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  newPlaceholder?: string;
  onCreate: (text: string) => Promise<void>;
  optional?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      await onCreate(text.trim());
      setText(""); setAdding(false);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Couldn't add that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
        {label}{optional && <span className="font-normal normal-case text-muted"> (optional)</span>}
      </label>
      {adding ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            className="input w-full text-sm"
            placeholder={newPlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(); }
              if (e.key === "Escape") { setAdding(false); setErr(null); }
            }}
          />
          <button type="button" disabled={busy || !text.trim()} onClick={submit}
            className="shrink-0 p-2 rounded-lg bg-emerald-500 text-white disabled:opacity-50" title="Save">
            <Check size={14} />
          </button>
          <button type="button" onClick={() => { setAdding(false); setErr(null); }}
            className="shrink-0 p-2 rounded-lg btn-secondary" title="Cancel">
            <XIcon size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select className="input w-full text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => { setAdding(true); setErr(null); }}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-lg btn-secondary text-xs font-semibold whitespace-nowrap" title={`Add new ${label.toLowerCase()}`}>
            <Plus size={13} /> New
          </button>
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{err}</p>}
    </div>
  );
}

export default function AddInventoryModal({
  branches: branchesProp,
  defaultBranchId,
  onClose,
}: {
  branches: any[];
  defaultBranchId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // Local mirrors so freshly-created options appear instantly in this modal.
  const [branches, setBranches] = useState<any[]>(branchesProp);
  const [byproductOptions, setByproductOptions] = useState(DEFAULT_BYPRODUCTS);
  const [units, setUnits] = useState<QuantityUnit[]>(() => allUnits());

  const [type, setType] = useState<StockType>("palay");
  const [branchId, setBranchId] = useState<string>(defaultBranchId || branchesProp[0]?.id || "");
  const [varietyId, setVarietyId] = useState<string>("");
  const [gradeId, setGradeId] = useState<string>("");
  const [gradeName, setGradeName] = useState<string>("premium");
  const [byproductType, setByproductType] = useState<string>("ipa");
  const [quantity, setQuantity] = useState<string>("");
  const [unitCode, setUnitCode] = useState<string>("kg");

  // Inline "add" toggle for a custom quantity unit (managed here, not in a select).
  const [addingUnit, setAddingUnit] = useState(false);
  const [newUnitLabel, setNewUnitLabel] = useState("");
  const [newUnitKg, setNewUnitKg] = useState("");

  const { data: varieties = [] } = useQuery<any[]>({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
  });
  const { data: grades = [] } = useQuery<any[]>({
    queryKey: ["grades"],
    queryFn: () => paddyService.listGrades(),
  });

  const needsVariety = type === "palay" || type === "milled_rice";

  const unit = units.find((u) => u.code === unitCode) ?? units[0];
  const qty = Number(quantity);
  const qtyValid = quantity !== "" && !Number.isNaN(qty) && qty > 0;
  const kg = qtyValid ? qty * unit.kgPerUnit : 0;
  const formValid = qtyValid && (!needsVariety || !!varietyId);

  /* ── inline creators ─────────────────────────────────────────────────────── */
  const createBranch = async (name: string) => {
    const created = await branchesService.create({ name });
    setBranches((prev) => [...prev, created]);
    setBranchId(created.id);
    qc.invalidateQueries({ queryKey: ["branches"] });
  };
  const createVariety = async (text: string) => {
    // Accept "CODE — Name" or just a code; backend needs code + name.
    const code = text.split(/[—-]/)[0].trim() || text.trim();
    const created = await paddyService.createVariety({ code, name: text.trim() });
    await qc.invalidateQueries({ queryKey: ["varieties"] });
    setVarietyId(created.id);
  };
  const createGrade = async (text: string) => {
    const created = await paddyService.createGrade({ code: text.trim(), name: text.trim() });
    await qc.invalidateQueries({ queryKey: ["grades"] });
    setGradeId(created.id);
  };
  const createByproduct = async (text: string) => {
    const value = slugify(text);
    if (!value) throw new Error("Enter a name.");
    setByproductOptions((prev) => prev.some((o) => o.value === value) ? prev : [...prev, { value, label: text.trim() }]);
    setByproductType(value);
  };

  const addUnit = () => {
    const label = newUnitLabel.trim();
    const factor = Number(newUnitKg);
    if (!label || Number.isNaN(factor) || factor <= 0) return;
    const created = saveCustomUnit(label, factor);
    setUnits(allUnits());
    setUnitCode(created.code);
    setNewUnitLabel(""); setNewUnitKg(""); setAddingUnit(false);
  };

  /* ── submit ──────────────────────────────────────────────────────────────── */
  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        quantity_kg: kg,
        branch_id: branchId || null,
      };
      if (type === "palay") {
        body.inventory_type = "palay";
        body.variety_id = varietyId;
        body.grade_id = gradeId || null;
      } else if (type === "milled_rice") {
        body.inventory_type = "milled_rice";
        body.variety_id = varietyId;
        body.grade_name = gradeName;
      } else {
        body.inventory_type = "byproduct";
        body.byproduct_type = byproductType;
      }
      return inventoryService.addStock(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["palay-inventory"] });
      qc.invalidateQueries({ queryKey: ["milled-rice"] });
      qc.invalidateQueries({ queryKey: ["byproducts"] });
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
      onClose();
    },
  });

  const errorMsg = useMemo(() => {
    if (!mutation.isError) return null;
    const err = mutation.error as any;
    const detail = err?.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (err?.response?.status === 403) return "Only owners and admins can add inventory.";
    if (!err?.response) return "Can't reach the server. Is the backend running?";
    return `Server returned ${err?.response?.status ?? "an error"}.`;
  }, [mutation.isError, mutation.error]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="add-inventory-title"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <button type="button" aria-label="Close"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onClose} />
      <div data-testid="add-inventory-modal"
        className="relative w-full max-w-[480px] max-h-[90vh] overflow-y-auto glass-strong rounded-2xl shadow-2xl ring-1 ring-soft p-5 animate-grad-fade-up">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 id="add-inventory-title" className="text-lg font-bold text-primary">Add inventory</h3>
            <p className="text-xs text-muted mt-0.5">Manually add stock on hand. Repeated adds to the same item accumulate.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="btn-ghost !p-1.5"><XIcon size={16} /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (formValid) mutation.mutate(); }} className="space-y-4">
          {/* Stock type — builtin + custom, with "+ New type" */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">Stock type</label>
            <div className="grid grid-cols-3 gap-2">
              {BUILTIN_TABS.map(({ key, label, icon: Icon }) => {
                const sel = type === key;
                return (
                  <button key={key} type="button" data-testid={`add-type-${key}`} onClick={() => setType(key)}
                    className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg ring-1 transition-all ${
                      sel ? "bg-emerald-500/10 ring-emerald-400 text-primary shadow-sm"
                          : "ring-soft text-secondary hover:ring-emerald-300 hover:bg-slate-50/50 dark:hover:bg-slate-700/30"}`}>
                    <Icon size={16} />
                    <span className="text-xs font-semibold">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Warehouse — with inline create */}
          <InlineCreateSelect
            label="Warehouse"
            value={branchId}
            onChange={setBranchId}
            placeholder="Unassigned"
            newPlaceholder="New warehouse name…"
            options={branches.map((b: any) => ({ value: b.id, label: `${b.name}${b.is_main_branch ? " (Main)" : ""}` }))}
            onCreate={createBranch}
          />

          {/* Variety — palay + milled, with inline create */}
          {needsVariety && (
            <InlineCreateSelect
              label="Variety"
              value={varietyId}
              onChange={setVarietyId}
              placeholder="Select a variety…"
              newPlaceholder="New variety (e.g. RC222 — Tubigan)…"
              options={varieties.map((v: any) => ({ value: v.id, label: `${v.code} — ${v.name}` }))}
              onCreate={createVariety}
            />
          )}

          {/* Grade */}
          {type === "palay" && (
            <InlineCreateSelect
              label="Grade" optional
              value={gradeId}
              onChange={setGradeId}
              placeholder="No grade"
              newPlaceholder="New grade code (e.g. Grade A)…"
              options={grades.map((g: any) => ({ value: g.id, label: g.code }))}
              onCreate={createGrade}
            />
          )}
          {type === "milled_rice" && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Grade</label>
              <select className="input w-full text-sm capitalize" value={gradeName} onChange={(e) => setGradeName(e.target.value)}>
                {MILLED_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          )}

          {/* By-product — with inline create */}
          {type === "byproduct" && (
            <InlineCreateSelect
              label="By-product"
              value={byproductType}
              onChange={setByproductType}
              newPlaceholder="New by-product name…"
              options={byproductOptions}
              onCreate={createByproduct}
            />
          )}

          {/* Quantity + unit selector + add custom unit */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Quantity</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min="0" step="any" inputMode="decimal" className="input w-full text-sm"
                placeholder="e.g. 1000" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              <select className="input text-sm shrink-0 max-w-[44%]" value={unitCode} onChange={(e) => setUnitCode(e.target.value)}>
                {units.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </select>
              <button type="button" title="Add a unit" onClick={() => setAddingUnit((v) => !v)}
                className="shrink-0 p-2 rounded-lg btn-secondary"><Plus size={14} /></button>
            </div>
            {addingUnit && (
              <div className="mt-2 flex items-center gap-1.5 p-2 rounded-lg ring-1 ring-emerald-300 bg-emerald-500/5">
                <input className="input w-full text-sm" placeholder="Unit name (e.g. Drum)"
                  value={newUnitLabel} onChange={(e) => setNewUnitLabel(e.target.value)} />
                <span className="text-xs text-muted shrink-0">=</span>
                <input type="number" min="0" step="any" className="input w-24 text-sm" placeholder="kg"
                  value={newUnitKg} onChange={(e) => setNewUnitKg(e.target.value)} />
                <button type="button" onClick={addUnit} disabled={!newUnitLabel.trim() || !(Number(newUnitKg) > 0)}
                  className="shrink-0 p-2 rounded-lg bg-emerald-500 text-white disabled:opacity-50" title="Save unit"><Check size={14} /></button>
              </div>
            )}
            {qtyValid && unit.code !== "kg" && (
              <p className="text-[11px] text-muted mt-1 tabular-nums">= {kg.toLocaleString()} kg</p>
            )}
          </div>

          {errorMsg && (
            <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-800/60 rounded-lg px-2.5 py-2 flex items-start gap-2">
              <span aria-hidden className="shrink-0 mt-0.5">⚠</span>
              <p className="min-w-0 break-words">{errorMsg}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-soft -mx-5 px-5 -mb-5 py-3 mt-4 sticky bottom-0 bg-inherit">
            <button type="button" onClick={onClose} className="btn-secondary !py-1.5 !px-3 text-sm">Cancel</button>
            <button type="submit" disabled={!formValid || mutation.isPending} className="btn-primary !py-1.5 !px-3 text-sm disabled:opacity-50">
              {mutation.isPending ? "Adding…" : "Add stock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
