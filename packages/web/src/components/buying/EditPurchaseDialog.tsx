// Correcting a saved purchase (edit power): its date, supplier, delivery and
// remarks, and its lines. Saved lines replace the old ones, the stock follows,
// and every changed field goes in the purchase's history.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import RecordDialog from "../sales/RecordDialog";
import Select from "../Select";
import DatePicker from "../DatePicker";
import { paddyService, type PurchaseEdit } from "../../services/PaddyService";
import { buyingService } from "../../services/BuyingService";
import { useByproductKinds } from "../../hooks/useByproductKinds";
import { MILLED_GRADES } from "../../mappers/InventoryMapper";
import { peso } from "./money";
import { gradeLabel, type TradeKind } from "./trade";
import WetDryChoice from "./WetDryChoice";
import FieldCaption from "../FieldCaption";
import { sortGrades } from "../../utils/grades";
import { fixFields, needsInput } from "../../utils/required";
import { selectPrompt } from "../../utils/selectPrompt";
import { varietyOptions } from "../../utils/varieties";
import { t } from "../../i18n";

type Line = Record<string, string>;

/** The numbers on a line, as each kind's create takes them. */
const NUMBERS: Record<
  TradeKind,
  { key: string; label: string; optional?: boolean; wetOnly?: boolean }[]
> = {
  palay: [
    { key: "sack_count", label: t("Sacks"), optional: true },
    { key: "cavan_count", label: t("Cavans (est.)"), optional: true },
    { key: "gross_weight_kg", label: t("Kilos (est.)"), optional: true },
    { key: "tare_weight_kg", label: t("Tare kg") },
    { key: "moisture_content_pct", label: t("Moisture %"), optional: true },
    { key: "impurity_pct", label: t("Impurities %"), optional: true },
    { key: "price_per_cavan", label: t("₱ per cavan") },
    { key: "dried_weight_kg", label: t("Weight after drying (kg)"), optional: true, wetOnly: true },
    {
      key: "dried_moisture_pct",
      label: t("Moisture after drying %"),
      optional: true,
      wetOnly: true,
    },
  ],
  rice: [
    { key: "sack_count", label: t("Sacks") },
    { key: "kg_per_sack", label: t("Kg per sack") },
    { key: "price_per_sack", label: t("₱ per sack") },
  ],
  byproduct: [
    { key: "weight_kg", label: t("Kilos") },
    { key: "price_per_kg", label: t("₱ per kg") },
  ],
};

const BLANK: Record<TradeKind, Line> = {
  palay: {
    variety_id: "",
    grade_id: "",
    sack_count: "",
    cavan_count: "",
    gross_weight_kg: "",
    tare_weight_kg: "0",
    moisture_content_pct: "",
    impurity_pct: "",
    weight_source: "",
    price_per_cavan: "",
    is_wet: "",
    dried_weight_kg: "",
    dried_moisture_pct: "",
  },
  rice: {
    variety_id: "",
    grade_name: "",
    sack_count: "",
    kg_per_sack: "50",
    price_per_sack: "",
  },
  byproduct: { byproduct_type: "ipa", weight_kg: "", price_per_kg: "" },
};

const DELIVERY: Record<TradeKind, { value: string; label: string }[]> = {
  palay: [
    { value: "delivered", label: t("Delivered") },
    { value: "farm_gate", label: t("Farm Gate") },
  ],
  rice: [
    { value: "delivered", label: t("Delivered") },
    { value: "picked_up", label: t("Picked up") },
  ],
  byproduct: [
    { value: "delivered", label: t("Delivered") },
    { value: "picked_up", label: t("Picked up") },
  ],
};

const text = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
const num = (v: string) => parseFloat(v) || 0;

/** A saved line, as the dialog edits it. */
function fromItem(kind: TradeKind, i: any): Line {
  const line: Line = { ...BLANK[kind] };
  for (const key of Object.keys(line)) {
    const value = i[key];
    if (key === "is_wet") line[key] = value ? "yes" : "";
    else if (value === null || value === undefined) line[key] = "";
    else line[key] = NUMBERS[kind].some((n) => n.key === key) ? text(value) : String(value);
  }
  return line;
}

/** Kilos bought: the weighed ones, else the cavans, else the sacks (50 kg each). */
const palayKg = (l: Line) =>
  l.gross_weight_kg !== ""
    ? num(l.gross_weight_kg) - num(l.tare_weight_kg)
    : (num(l.cavan_count) || num(l.sack_count)) * 50;

const lineAmount = (kind: TradeKind, l: Line) =>
  kind === "palay"
    ? (palayKg(l) / 50) * num(l.price_per_cavan)
    : kind === "rice"
      ? num(l.sack_count) * num(l.price_per_sack)
      : num(l.weight_kg) * num(l.price_per_kg);

function lineIsValid(kind: TradeKind, l: Line): boolean {
  const filled = NUMBERS[kind].every((n) => n.optional || l[n.key] !== "");
  if (!filled || NUMBERS[kind].some((n) => num(l[n.key]) < 0)) return false;
  if (kind === "palay") {
    const counted = l.gross_weight_kg !== "" || l.cavan_count !== "" || l.sack_count !== "";
    return (
      counted &&
      palayKg(l) > 0 &&
      (l.is_wet !== "yes" || l.dried_weight_kg === "" || num(l.dried_weight_kg) > 0)
    );
  }
  if (kind === "rice") return num(l.sack_count) > 0 && num(l.kg_per_sack) > 0;
  return !!l.byproduct_type && num(l.weight_kg) > 0;
}

/** The numbers of a line that are empty or can't be right: what the notices point at. */
function lineMissing(kind: TradeKind, l: Line): Set<string> {
  const missing = new Set<string>();
  for (const n of NUMBERS[kind]) {
    if (n.wetOnly && l.is_wet !== "yes") continue;
    if (!n.optional && l[n.key] === "") missing.add(n.key);
  }
  if (kind === "palay") {
    if (palayKg(l) <= 0) missing.add("sack_count");
    if (l.is_wet === "yes" && l.dried_weight_kg !== "" && num(l.dried_weight_kg) <= 0) {
      missing.add("dried_weight_kg");
    }
  }
  if (kind === "rice") {
    for (const key of ["sack_count", "kg_per_sack"]) if (!(num(l[key]) > 0)) missing.add(key);
  }
  if (kind === "byproduct" && !(num(l.weight_kg) > 0)) missing.add("weight_kg");
  return missing;
}

/** A line as the server takes it: numbers as numbers, blanks as null. */
function toItem(kind: TradeKind, l: Line): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(l)) {
    const isNumber = NUMBERS[kind].some((n) => n.key === key);
    item[key] = value === "" ? null : isNumber ? num(value) : value;
  }
  if (kind === "palay") {
    const wet = l.is_wet === "yes";
    item.is_wet = wet;
    if (!wet) {
      item.dried_weight_kg = null;
      item.dried_moisture_pct = null;
    }
  }
  return item;
}

const SAVE: Record<TradeKind, (id: string, body: PurchaseEdit) => Promise<any>> = {
  palay: (id, body) => paddyService.editPurchase(id, body),
  rice: (id, body) => buyingService.editRicePurchase(id, body),
  byproduct: (id, body) => buyingService.editByproductPurchase(id, body),
};

/** What the page and the stock views show of a purchase, to fetch again. */
const AFFECTED: Record<TradeKind, string[]> = {
  palay: ["palay-purchases", "palay-inventory"],
  rice: ["rice-purchases", "rice-stock", "milled-rice"],
  byproduct: ["byproduct-purchases", "byproduct-stock", "byproducts", "byproduct-kinds"],
};

export default function EditPurchaseDialog({
  kind,
  purchase,
  onClose,
}: {
  kind: TradeKind;
  purchase: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState<string>(purchase.supplier_id ?? "");
  const [date, setDate] = useState<string>(purchase.purchase_date ?? "");
  const [delivery, setDelivery] = useState<string>(purchase.delivery_type ?? "");
  const [remarks, setRemarks] = useState<string>(purchase.remarks ?? "");
  const [weightReason, setWeightReason] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    (purchase.items ?? []).map((i: any) => fromItem(kind, i)),
  );

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["suppliers"],
    queryFn: () => paddyService.listSuppliers(),
  });
  const { data: varieties = [] } = useQuery<any[]>({
    queryKey: ["varieties"],
    queryFn: () => paddyService.listVarieties(),
    enabled: kind !== "byproduct",
  });
  const { data: grades = [] } = useQuery<any[]>({
    queryKey: ["grades"],
    queryFn: () => paddyService.listGrades(),
    enabled: kind === "palay",
  });
  const { active: byproductKinds } = useByproductKinds();

  const total = lines.reduce((sum, l) => sum + lineAmount(kind, l), 0);
  const valid = !!date && lines.length > 0 && lines.every((l) => lineIsValid(kind, l));
  // After a try at saving with something missing, the empty fields say so.
  const [attempted, setAttempted] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      SAVE[kind](purchase.id, {
        supplier_id: supplierId || null,
        purchase_date: date,
        delivery_type: delivery || null,
        remarks: remarks.trim() || null,
        items: lines.map((l) => toItem(kind, l)),
        ...(kind === "palay" && weightReason.trim()
          ? { weight_change_reason: weightReason.trim() }
          : {}),
      }),
    onSuccess: () => {
      for (const key of [...AFFECTED[kind], "inventory-summary", "record-history"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;

  const submit = () => {
    setAttempted(true);
    if (valid) save.mutate();
  };

  const setLine = (i: number, patch: Line) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // A variety, grade or by-product the purchase has but the list hides stays pickable.
  const withCurrent = (
    options: { value: string; label: string }[],
    value: string,
    label: string | null | undefined,
  ) =>
    !value || options.some((o) => o.value === value)
      ? options
      : [...options, { value, label: label || value }];

  const supplierOptions = withCurrent(
    [
      { value: "", label: selectPrompt(t("Supplier")) },
      ...suppliers.map((s: any) => ({ value: String(s.id), label: s.name })),
    ],
    supplierId,
    purchase.supplier?.name,
  );
  // Palay purchases pick from the palay list, rice purchases from the rice list.
  const pickableVarieties = [
    { value: "", label: selectPrompt(t("Variety")) },
    ...varietyOptions(varieties, kind === "palay" ? "palay" : "rice"),
  ];
  const gradeOptions = [
    { value: "", label: selectPrompt(t("Grade")) },
    ...sortGrades(grades).map((g: any) => ({ value: g.id, label: g.code })),
  ];
  const byproductOptions = byproductKinds.map((k) => ({ value: k.code, label: k.name }));

  const whatPickers = (l: Line, i: number) => {
    const saved = purchase.items?.[i];
    if (kind === "byproduct")
      return (
        <Select
          aria-label={t("By-product of line {{value}}", { value: i + 1 })}
          value={l.byproduct_type}
          onChange={(v) => setLine(i, { byproduct_type: v })}
          options={withCurrent(byproductOptions, l.byproduct_type, l.byproduct_type)}
        />
      );
    // One above the other on a phone: side by side the variety was cut to "NSIC R…".
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select
          aria-label={t("Variety of line {{value}}", { value: i + 1 })}
          value={l.variety_id}
          onChange={(v) => setLine(i, { variety_id: v })}
          options={withCurrent(pickableVarieties, l.variety_id, saved?.variety_code)}
        />
        {kind === "palay" ? (
          <Select
            aria-label={t("Grade of line {{value}}", { value: i + 1 })}
            value={l.grade_id}
            onChange={(v) => setLine(i, { grade_id: v })}
            options={withCurrent(gradeOptions, l.grade_id, saved?.grade_code)}
          />
        ) : (
          <Select
            aria-label={t("Grade of line {{value}}", { value: i + 1 })}
            placeholder={selectPrompt(t("Grade"))}
            value={l.grade_name}
            onChange={(v) => setLine(i, { grade_name: v })}
            options={MILLED_GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))}
          />
        )}
      </div>
    );
  };

  return (
    <RecordDialog
      title={t("Edit purchase {{reference_no}}", { reference_no: purchase.reference_no })}
      subtitle={t(
        "Stock follows the lines you save, and every change goes in the purchase's history.",
      )}
      onClose={onClose}
      busy={save.isPending}
      testId="edit-purchase"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            {t("Cancel")}
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={save.isPending}>
            {save.isPending ? t("Saving…") : t("Save changes")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Date")}</span>
            <DatePicker value={date} onChange={setDate} aria-label={t("Purchase date")} />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Supplier")}</span>
            <Select
              aria-label={t("Supplier")}
              value={supplierId}
              onChange={setSupplierId}
              options={supplierOptions}
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">{t("Delivery")}</span>
            <Select
              aria-label={t("Delivery")}
              value={delivery}
              onChange={setDelivery}
              options={withCurrent(DELIVERY[kind], delivery, delivery)}
            />
          </label>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-secondary">{t("Lines")}</p>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div
                key={i}
                className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-slate-900/50"
                data-testid="purchase-line"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">{whatPickers(l, i)}</div>
                  <button
                    type="button"
                    className="btn-ghost !p-2"
                    aria-label={t("Remove line {{value}}", { value: i + 1 })}
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {kind === "palay" && (
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-muted">{t("Condition")}</span>
                    <WetDryChoice
                      wet={l.is_wet === "yes"}
                      name={String(i + 1)}
                      onChange={(wet) => setLine(i, { is_wet: wet ? "yes" : "" })}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {NUMBERS[kind]
                    .filter((n) => !n.wetOnly || l.is_wet === "yes")
                    .map((n) => (
                      <FieldCaption
                        key={n.key}
                        label={n.label}
                        error={
                          attempted && lineMissing(kind, l).has(n.key) ? needsInput() : undefined
                        }
                      >
                        <input
                          className="input"
                          type="number"
                          min={0}
                          aria-label={t("{{label}} of line {{value}}", {
                            label: n.label,
                            value: i + 1,
                          })}
                          value={l[n.key]}
                          onChange={(e) => setLine(i, { [n.key]: e.target.value })}
                        />
                      </FieldCaption>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => setLines((ls) => [...ls, { ...BLANK[kind] }])}
            >
              <Plus size={15} /> {t("Add line")}
            </button>
            <p className="text-sm text-secondary">
              {t("New total:")} <span className="font-semibold text-primary">{peso(total)}</span>
            </p>
          </div>
        </div>

        <label className="block">
          <span className="block mb-1 text-xs font-medium text-secondary">{t("Remarks")}</span>
          <textarea
            className="input min-h-[4rem]"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </label>

        {kind === "palay" && (
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">
              {t("Reason, if a weight changed")}
            </span>
            <input
              className="input"
              maxLength={300}
              value={weightReason}
              onChange={(e) => setWeightReason(e.target.value)}
            />
          </label>
        )}

        {attempted && !valid && (
          <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
            {fixFields()}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {typeof error === "string"
              ? error
              : t("Couldn't save. Check the fields and try again.")}
          </p>
        )}
      </div>
    </RecordDialog>
  );
}
