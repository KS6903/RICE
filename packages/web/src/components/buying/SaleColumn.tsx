// The right half of a Buy & mill page: what was sold. These are ordinary sales
// orders (the Sales page lists them too), narrowed to the ones that sell this
// page's goods. Clicking one opens it in a popup; New Sale records one here.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, ShoppingCart } from "lucide-react";
import { salesService } from "../../services/SalesService";
import { useAccess } from "../../hooks/useAccess";
import { useFeature } from "../../hooks/useFeature";
import EmptyState from "../EmptyState";
import LoadingRows from "../LoadingRows";
import Modal from "../Modal";
import NewSaleModal from "./NewSaleModal";
import { peso } from "./money";
import {
  GOODS,
  SALE_ITEM_TYPE,
  STATUS_BADGE,
  linesOf,
  saleLineName,
  type TradeKind,
} from "./trade";
import { t } from "../../i18n";
import { statusText } from "../../utils/statusText";

export default function SaleColumn({ kind }: { kind: TradeKind }) {
  const { canView, canEdit } = useAccess();
  const hasSales = useFeature("sales");
  const allowed = hasSales && canView("sales");
  const canSell = allowed && canEdit("sales");
  const [selling, setSelling] = useState(false);
  const [open, setOpen] = useState<any | null>(null);

  const { data: orders = [], isLoading } = useQuery<any[]>({
    queryKey: ["sales-orders", SALE_ITEM_TYPE[kind]],
    queryFn: () => salesService.listOrders(SALE_ITEM_TYPE[kind]),
    enabled: allowed,
  });
  const total = orders.reduce((s, o) => s + linesOf(o, kind).amount, 0);

  return (
    <section className="space-y-2 min-w-0" data-testid="sales-column" aria-label={t("Sales")}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{t("Sales")}</h3>
          <p className="text-xs text-muted tabular-nums">
            {isLoading ? (
              t("Loading…")
            ) : allowed ? (
              <>
                {t("{{ordersCount}} sold", { ordersCount: orders.length })}
                {orders.length > 0 && <> · {peso(total)}</>}
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        {canSell && (
          <button onClick={() => setSelling(true)} className="btn-primary">
            <Plus size={16} /> {t("New Sale")}
          </button>
        )}
      </div>
      <div className="card overflow-hidden p-0">
        {!hasSales ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {t("Selling is part of the Sales feature, on plans that include it.")}
          </p>
        ) : !canView("sales") ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {t("Your role doesn't see sales. The owner can change that in Users.")}
          </p>
        ) : isLoading ? (
          <LoadingRows />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={t("No {{GOODS}} sold yet", { GOODS: GOODS[kind] })}
            action={canSell ? t("Record a sale") : undefined}
            onAction={() => setSelling(true)}
            next="It also shows on the Sales page, ready to invoice."
          >
            {t(
              "Each time you sell {{GOODS}} to a customer, record the weight and the price here.",
              { GOODS: GOODS[kind] },
            )}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700">
            {orders.map((o) => {
              const mine = linesOf(o, kind);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(o)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted">{o.order_no}</p>
                      <p className="truncate font-semibold text-gray-900 dark:text-slate-100">
                        {o.customer?.name ?? t("No customer")}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {o.order_date} · {mine.lines.map(saleLineName).join(", ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums text-gray-900 dark:text-slate-100">
                        {t("{{kg}} kg", { kg: mine.kg.toLocaleString() })}
                      </p>
                      <p className="text-xs tabular-nums text-muted">{peso(mine.amount)}</p>
                      <span
                        className={`mt-1 inline-block ${STATUS_BADGE[o.status] || "badge-gray"}`}
                      >
                        {statusText(o.status)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {open && <SaleDetails kind={kind} order={open} onClose={() => setOpen(null)} />}
      {selling && <NewSaleModal kind={kind} onClose={() => setSelling(false)} />}
    </section>
  );
}

/* ── The popup ───────────────────────────────────────────────────────────── */

export function SaleDetails({
  kind,
  order: o,
  onClose,
}: {
  kind: TradeKind;
  order: any;
  onClose: () => void;
}) {
  const mine = linesOf(o, kind);
  const inv = o.invoice;
  const facts: [string, React.ReactNode][] = [
    [t("Date"), o.order_date],
    [t("Customer"), o.customer?.name ?? "—"],
    [
      t("Status"),
      <span key="s" className={STATUS_BADGE[o.status] || "badge-gray"}>
        {statusText(o.status)}
      </span>,
    ],
    [t("Delivery date"), o.delivery_date ?? "—"],
    [t("Invoice"), inv ? `${inv.invoice_no} (${statusText(inv.status)})` : t("Not billed yet")],
    [
      t("Paid"),
      inv ? `${peso(Number(inv.paid_amount ?? 0))} of ${peso(Number(inv.total_amount ?? 0))}` : "—",
    ],
  ];
  return (
    <Modal
      open
      size="lg"
      title={t("Sale {{order_no}}", { order_no: o.order_no })}
      subtitle={o.customer?.address ?? undefined}
      onClose={onClose}
      testId="sale-details"
      footer={
        <Link to="/sales" className="btn-secondary">
          {t("Open in Sales")}
        </Link>
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
              {[t("Item"), t("Weight"), t("Per kg"), t("Amount")].map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2 font-medium text-gray-600 dark:text-slate-300 ${i ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {mine.lines.map((l: any) => (
              <tr key={l.id}>
                <td className="px-3 py-2">{saleLineName(l)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {t("{{toLocaleString}} kg", {
                    toLocaleString: Number(l.quantity_kg).toLocaleString(),
                  })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {peso(Number(l.unit_price_per_kg ?? 0))}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {peso(Number(l.line_total ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-sm text-right">
        {mine.others > 0 && (
          <p className="text-muted">
            {t("The order also has {{count}} other lines; open it in Sales for the whole order.", {
              count: mine.others,
            })}
          </p>
        )}
        {Number(o.discount_pct) > 0 && (
          <p className="text-muted">
            {t("Discount {{discount_pct}}% on the whole order", {
              discount_pct: Number(o.discount_pct),
            })}
          </p>
        )}
        <p className="text-primary">
          {t("Order total:")}{" "}
          <span className="font-bold tabular-nums">{peso(Number(o.total_amount ?? 0))}</span>
        </p>
      </div>

      {o.remarks && (
        <p className="mt-4 text-sm text-secondary">
          <span className="font-semibold text-primary">{t("Remarks:")}</span> {o.remarks}
        </p>
      )}
    </Modal>
  );
}
