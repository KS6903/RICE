// The left half of a Buy & mill page: what was bought. Each purchase is a row;
// clicking it opens the full purchase in a popup.
import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { roleLabel } from "@rice-mill/shared";
import Modal from "../Modal";
import { inSeveralWarehouses } from "../PurchaseWarehouse";
import { peso } from "./money";
import { STATUS_BADGE, byproductName, gradeLabel, type TradeKind } from "./trade";

export default function PurchaseColumn({
  kind,
  purchases,
  canBuy,
  onNew,
  empty,
}: {
  kind: TradeKind;
  purchases: any[];
  canBuy: boolean;
  onNew: () => void;
  /** What to show when nothing has been bought yet. */
  empty: ReactNode;
}) {
  const [open, setOpen] = useState<any | null>(null);
  const several = inSeveralWarehouses(purchases);
  const total = purchases.reduce((s, p) => s + Number(p.total_amount ?? 0), 0);

  return (
    <section className="space-y-2 min-w-0" data-testid="purchases-column" aria-label="Purchases">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">Purchases</h3>
          <p className="text-xs text-muted tabular-nums">
            {purchases.length} bought{purchases.length > 0 && <> · {peso(total)}</>}
          </p>
        </div>
        {canBuy && (
          <button onClick={onNew} className="btn-primary">
            <Plus size={16} /> New Purchase
          </button>
        )}
      </div>
      <div className="card overflow-hidden p-0">
        {purchases.length === 0 ? (
          empty
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700">
            {purchases.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpen(p)}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted">{p.reference_no}</p>
                    <p className="truncate font-semibold text-gray-900 dark:text-slate-100">
                      {p.supplier?.name ?? "No supplier"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {p.purchase_date}
                      {several && p.branch?.name && <> · {p.branch.name}</>}
                      {p.created_by_name && <> · by {p.created_by_name}</>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-gray-900 dark:text-slate-100">
                      {Number(p.total_kg ?? 0).toLocaleString()} kg
                    </p>
                    <p className="text-xs tabular-nums text-muted">
                      {peso(Number(p.total_amount ?? 0))}
                    </p>
                    <span className={`mt-1 inline-block ${STATUS_BADGE[p.status] || "badge-gray"}`}>
                      {p.status}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && <PurchaseDetails kind={kind} purchase={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/* ── The popup ───────────────────────────────────────────────────────────── */

type Col = { label: string; value: (line: any) => ReactNode; numeric?: boolean };

const kg = (v: unknown) => `${Number(v ?? 0).toLocaleString()} kg`;

const LINE_COLUMNS: Record<TradeKind, Col[]> = {
  palay: [
    { label: "Variety", value: (l) => l.variety_code ?? "—" },
    { label: "Grade", value: (l) => l.grade_code ?? "—" },
    { label: "Gross", value: (l) => kg(l.gross_weight_kg), numeric: true },
    { label: "Tare", value: (l) => kg(l.tare_weight_kg), numeric: true },
    { label: "Net", value: (l) => kg(l.net_weight_kg), numeric: true },
    {
      label: "Moisture",
      value: (l) => (l.moisture_content_pct != null ? `${Number(l.moisture_content_pct)}%` : "—"),
      numeric: true,
    },
    { label: "Per cavan", value: (l) => peso(Number(l.price_per_cavan ?? 0)), numeric: true },
  ],
  rice: [
    { label: "Variety", value: (l) => l.variety_code ?? "—" },
    { label: "Grade", value: (l) => gradeLabel(l.grade_name) },
    { label: "Sacks", value: (l) => Number(l.sack_count).toLocaleString(), numeric: true },
    { label: "Kg/sack", value: (l) => Number(l.kg_per_sack).toLocaleString(), numeric: true },
    { label: "Weight", value: (l) => kg(l.weight_kg), numeric: true },
    { label: "Per sack", value: (l) => peso(Number(l.price_per_sack ?? 0)), numeric: true },
  ],
  byproduct: [
    { label: "By-product", value: (l) => byproductName(l.byproduct_type) },
    { label: "Weight", value: (l) => kg(l.weight_kg), numeric: true },
    { label: "Per kg", value: (l) => peso(Number(l.price_per_kg ?? 0)), numeric: true },
  ],
};

const DELIVERY: Record<string, string> = {
  delivered: "Delivered",
  farm_gate: "Farm gate",
  picked_up: "Picked up",
};

export function PurchaseDetails({
  kind,
  purchase: p,
  onClose,
}: {
  kind: TradeKind;
  purchase: any;
  onClose: () => void;
}) {
  const cols = LINE_COLUMNS[kind];
  const facts: [string, ReactNode][] = [
    ["Date", p.purchase_date],
    ["Supplier", p.supplier?.name ?? "—"],
    ["Warehouse", p.branch?.name ?? "—"],
    ["Delivery", p.delivery_type ? (DELIVERY[p.delivery_type] ?? p.delivery_type) : "—"],
    [
      "Status",
      <span key="s" className={STATUS_BADGE[p.status] || "badge-gray"}>
        {p.status}
      </span>,
    ],
    [
      "Recorded by",
      p.created_by_name
        ? `${p.created_by_name}${p.created_by_role ? ` (${roleLabel(p.created_by_role)})` : ""}`
        : "—",
    ],
  ];
  return (
    <Modal
      open
      size="xl"
      title={`Purchase ${p.reference_no}`}
      subtitle={`${p.item_count ?? p.items?.length ?? 0} item(s)`}
      onClose={onClose}
      testId="purchase-details"
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-soft dark:bg-slate-800/50"
          >
            <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-primary">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-soft">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/50">
            <tr>
              {[...cols, { label: "Amount", numeric: true }].map((c) => (
                <th
                  key={c.label}
                  className={`px-3 py-2 font-medium text-gray-600 dark:text-slate-300 ${c.numeric ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {(p.items ?? []).map((line: any) => (
              <tr key={line.id}>
                {cols.map((c) => (
                  <td
                    key={c.label}
                    className={`px-3 py-2 ${c.numeric ? "text-right tabular-nums" : ""}`}
                  >
                    {c.value(line)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {peso(Number(line.line_total ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-soft">
            <tr>
              <td colSpan={cols.length} className="px-3 py-2 text-right text-muted">
                Total · {kg(p.total_kg)}
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-primary">
                {peso(Number(p.total_amount ?? 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {p.remarks && (
        <p className="mt-4 text-sm text-secondary">
          <span className="font-semibold text-primary">Remarks:</span> {p.remarks}
        </p>
      )}
    </Modal>
  );
}
