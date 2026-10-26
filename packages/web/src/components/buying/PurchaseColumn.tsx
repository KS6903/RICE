// The left half of a Buy & mill page: what was bought. Each purchase is a row;
// clicking it opens the full purchase in a popup, where someone with edit power
// corrects it and anyone who buys sees its history.
import { useState, type ReactNode } from "react";
import { History, Pencil, Plus } from "lucide-react";
import { roleLabel } from "@rice-mill/shared";
import Modal from "../Modal";
import LoadingRows from "../LoadingRows";
import { inSeveralWarehouses } from "../PurchaseWarehouse";
import { peso } from "./money";
import { STATUS_BADGE, byproductName, gradeLabel, type TradeKind } from "./trade";
import EditPurchaseDialog from "./EditPurchaseDialog";
import RecordHistory, { type RecordKind } from "../sales/RecordHistory";
import { useCanEditSavedRecords } from "../../hooks/useRecordEditor";
import { t } from "../../i18n";
import { statusText } from "../../utils/statusText";

const HISTORY_KIND: Record<TradeKind, RecordKind> = {
  palay: "palay_purchase",
  rice: "rice_purchase",
  byproduct: "byproduct_purchase",
};

export default function PurchaseColumn({
  kind,
  purchases,
  canBuy,
  onNew,
  empty,
  loading = false,
}: {
  kind: TradeKind;
  purchases: any[];
  canBuy: boolean;
  onNew: () => void;
  /** What to show when nothing has been bought yet. */
  empty: ReactNode;
  /** The purchases are still on their way: show that, not `empty`. */
  loading?: boolean;
}) {
  const [open, setOpen] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [history, setHistory] = useState<any | null>(null);
  const canCorrect = useCanEditSavedRecords();
  const canSeeHistory = canCorrect || canBuy;
  const several = inSeveralWarehouses(purchases);
  const total = purchases.reduce((s, p) => s + Number(p.total_amount ?? 0), 0);

  return (
    <section
      className="space-y-2 min-w-0"
      data-testid="purchases-column"
      aria-label={t("Purchases")}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{t("Purchases")}</h3>
          <p className="text-xs text-muted tabular-nums">
            {loading ? (
              t("Loading…")
            ) : (
              <>
                {t("{{purchasesCount}} bought", { purchasesCount: purchases.length })}
                {purchases.length > 0 && <> · {peso(total)}</>}
              </>
            )}
          </p>
        </div>
        {canBuy && (
          <button onClick={onNew} className="btn-primary shrink-0">
            <Plus size={16} /> {t("New Purchase")}
          </button>
        )}
      </div>
      <div className="card overflow-hidden p-0">
        {loading ? (
          <LoadingRows />
        ) : purchases.length === 0 ? (
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
                      {p.supplier?.name ?? t("No supplier")}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {p.purchase_date}
                      {several && p.branch?.name && <> · {p.branch.name}</>}
                      {p.created_by_name && (
                        <>
                          {" "}
                          {t("· by {{created_by_name}}", { created_by_name: p.created_by_name })}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-gray-900 dark:text-slate-100">
                      {Number(p.total_kg ?? 0).toLocaleString()} {t("kg")}
                    </p>
                    <p className="text-xs tabular-nums text-muted">
                      {peso(Number(p.total_amount ?? 0))}
                    </p>
                    <span className={`mt-1 inline-block ${STATUS_BADGE[p.status] || "badge-gray"}`}>
                      {statusText(p.status)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && (
        <PurchaseDetails
          kind={kind}
          purchase={open}
          onClose={() => setOpen(null)}
          onEdit={
            canCorrect
              ? () => {
                  setEditing(open);
                  setOpen(null);
                }
              : undefined
          }
          onHistory={
            canSeeHistory
              ? () => {
                  setHistory(open);
                  setOpen(null);
                }
              : undefined
          }
        />
      )}
      {editing && (
        <EditPurchaseDialog kind={kind} purchase={editing} onClose={() => setEditing(null)} />
      )}
      {history && (
        <RecordHistory
          kind={HISTORY_KIND[kind]}
          id={history.id}
          label={history.reference_no}
          onClose={() => setHistory(null)}
        />
      )}
    </section>
  );
}

/* ── The popup ───────────────────────────────────────────────────────────── */

type Col = { label: string; value: (line: any) => ReactNode; numeric?: boolean };

const kg = (v: unknown) => `${Number(v ?? 0).toLocaleString()} kg`;

const LINE_COLUMNS: Record<TradeKind, Col[]> = {
  palay: [
    { label: t("Variety"), value: (l) => l.variety_code ?? "—" },
    { label: t("Grade"), value: (l) => l.grade_code ?? "—" },
    { label: t("Gross"), value: (l) => kg(l.gross_weight_kg), numeric: true },
    { label: t("Tare"), value: (l) => kg(l.tare_weight_kg), numeric: true },
    { label: t("Net"), value: (l) => kg(l.net_weight_kg), numeric: true },
    {
      label: t("Moisture"),
      value: (l) => (l.moisture_content_pct != null ? `${Number(l.moisture_content_pct)}%` : "—"),
      numeric: true,
    },
    { label: t("Per cavan"), value: (l) => peso(Number(l.price_per_cavan ?? 0)), numeric: true },
  ],
  rice: [
    { label: t("Variety"), value: (l) => l.variety_code ?? "—" },
    { label: t("Grade"), value: (l) => gradeLabel(l.grade_name) },
    { label: t("Sacks"), value: (l) => Number(l.sack_count).toLocaleString(), numeric: true },
    { label: "Kg/sack", value: (l) => Number(l.kg_per_sack).toLocaleString(), numeric: true },
    { label: t("Weight"), value: (l) => kg(l.weight_kg), numeric: true },
    { label: t("Per sack"), value: (l) => peso(Number(l.price_per_sack ?? 0)), numeric: true },
  ],
  byproduct: [
    { label: t("By-product"), value: (l) => byproductName(l.byproduct_type) },
    { label: t("Weight"), value: (l) => kg(l.weight_kg), numeric: true },
    { label: t("Per kg"), value: (l) => peso(Number(l.price_per_kg ?? 0)), numeric: true },
  ],
};

const DELIVERY: Record<string, string> = {
  delivered: t("Delivered"),
  farm_gate: t("Farm gate"),
  picked_up: t("Picked up"),
};

export function PurchaseDetails({
  kind,
  purchase: p,
  onClose,
  onEdit,
  onHistory,
}: {
  kind: TradeKind;
  purchase: any;
  onClose: () => void;
  /** Correct it (edit power); left out, no Edit button. */
  onEdit?: () => void;
  /** Its logged changes; left out, no History button. */
  onHistory?: () => void;
}) {
  const cols = LINE_COLUMNS[kind];
  const facts: [string, ReactNode][] = [
    [t("Date"), p.purchase_date],
    [t("Supplier"), p.supplier?.name ?? "—"],
    [t("Warehouse"), p.branch?.name ?? "—"],
    [t("Delivery"), p.delivery_type ? (DELIVERY[p.delivery_type] ?? p.delivery_type) : "—"],
    [
      t("Status"),
      <span key="s" className={STATUS_BADGE[p.status] || "badge-gray"}>
        {statusText(p.status)}
      </span>,
    ],
    [
      t("Recorded by"),
      p.created_by_name
        ? `${p.created_by_name}${p.created_by_role ? ` (${t(roleLabel(p.created_by_role))})` : ""}`
        : "—",
    ],
  ];
  return (
    <Modal
      open
      size="xl"
      title={t("Purchase {{reference_no}}", { reference_no: p.reference_no })}
      subtitle={`${p.item_count ?? p.items?.length ?? 0} item(s)`}
      onClose={onClose}
      testId="purchase-details"
      footer={
        (onEdit || onHistory) && (
          <div className="flex justify-end gap-2">
            {onHistory && (
              <button type="button" className="btn-secondary" onClick={onHistory}>
                <History size={15} aria-hidden /> {t("History")}
              </button>
            )}
            {onEdit && (
              <button type="button" className="btn-primary" onClick={onEdit}>
                <Pencil size={15} aria-hidden /> {t("Edit")}
              </button>
            )}
          </div>
        )
      }
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
              {[...cols, { label: t("Amount"), numeric: true }].map((c) => (
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
                {t("Total · {{total_kg}}", { total_kg: kg(p.total_kg) })}
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
          <span className="font-semibold text-primary">{t("Remarks:")}</span> {p.remarks}
        </p>
      )}
    </Modal>
  );
}
