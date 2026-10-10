import { useEscapeKey } from "../../hooks/useEscapeKey";
import { createPortal } from "react-dom";
import { addDays, format } from "date-fns";
import { AlertCircle, FileText, X as XIcon } from "lucide-react";
import { BYPRODUCT_NAMES } from "../../mappers/InventoryMapper";

type OrderItem = {
  id: string;
  item_type: string;
  variety_name: string | null;
  grade_name: string | null;
  byproduct_type: string | null;
  quantity_kg: number | string;
  unit_price_per_kg: number | string;
  line_total: number | string;
};

export type PreviewOrder = {
  id: string;
  order_no: string;
  order_date: string;
  subtotal: number | string | null;
  discount_pct: number | string | null;
  discount_amount: number | string | null;
  total_amount: number | string | null;
  customer: {
    name: string;
    address: string | null;
    tin: string | null;
    payment_terms_days: number | null;
  } | null;
  items?: OrderItem[];
};

type Props = {
  order: PreviewOrder;
  onClose: () => void;
  onGenerate: () => void;
  pending: boolean;
  error: string | null;
};

const peso = (n: number | string | null | undefined) =>
  `₱${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kg = (n: number | string) =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });

function describe(i: OrderItem): string {
  if (i.item_type === "byproduct") {
    return BYPRODUCT_NAMES[i.byproduct_type ?? ""] ?? i.byproduct_type ?? "By-product";
  }
  const rice = i.variety_name || "Milled rice";
  return i.grade_name ? `${rice}, ${i.grade_name}` : rice;
}

/**
 * Shows the invoice as it will be issued, before it exists: generating one
 * bills the customer and moves the order to "invoiced", so it is a look first,
 * then a deliberate button. The number is assigned by the server on generating.
 *
 * Rendered into <body>: the page's content wrapper is animated, and a
 * transformed ancestor would trap a `fixed` backdrop inside it.
 */
export default function InvoicePreviewModal({ order, onClose, onGenerate, pending, error }: Props) {
  // Escape closes it, but not while the invoice is being generated.
  useEscapeKey(onClose, !pending);

  const today = new Date();
  const terms = order.customer?.payment_terms_days ?? 0;
  const due = addDays(today, terms);
  const items = order.items ?? [];
  const discount = Number(order.discount_amount ?? 0);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-preview-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => !pending && onClose()}
      />
      <div
        data-testid="invoice-preview"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl ring-1 ring-soft dark:bg-slate-900"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-emerald-600 dark:text-emerald-400" />
            <h3 id="invoice-preview-title" className="text-base font-bold text-primary">
              Preview invoice
            </h3>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={pending}
            className="btn-ghost !p-1.5"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* The sheet: stays white like paper, in dark mode too */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="rounded-xl bg-white p-6 text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-2xl font-extrabold tracking-tight">INVOICE</p>
                <p className="mt-1 text-xs text-slate-500">
                  Order <span className="font-mono">{order.order_no}</span>, placed{" "}
                  {format(new Date(`${order.order_date}T00:00:00`), "MMM d, yyyy")}
                </p>
              </div>
              <div className="text-right text-xs">
                <span className="inline-block rounded-md bg-amber-100 px-2 py-0.5 font-bold uppercase tracking-wider text-amber-800">
                  Preview
                </span>
                <dl className="mt-2 space-y-0.5 text-slate-600">
                  <div className="flex justify-end gap-2">
                    <dt className="text-slate-500">Invoice no.</dt>
                    <dd className="font-medium">Assigned when generated</dd>
                  </div>
                  <div className="flex justify-end gap-2">
                    <dt className="text-slate-500">Date</dt>
                    <dd className="font-medium">{format(today, "MMM d, yyyy")}</dd>
                  </div>
                  <div className="flex justify-end gap-2">
                    <dt className="text-slate-500">Due</dt>
                    <dd className="font-medium">
                      {format(due, "MMM d, yyyy")}
                      <span className="ml-1 font-normal text-slate-500">
                        {terms > 0 ? `(${terms} days)` : "(on receipt)"}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Bill to
              </p>
              <p className="mt-1 text-base font-semibold">
                {order.customer?.name ?? "No customer on this order"}
              </p>
              {order.customer?.address && (
                <p className="text-sm text-slate-600">{order.customer.address}</p>
              )}
              {order.customer?.tin && (
                <p className="text-sm text-slate-600">TIN {order.customer.tin}</p>
              )}
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 px-3 text-right">Qty (kg)</th>
                    <th className="py-2 px-3 text-right">Price / kg</th>
                    <th className="py-2 pl-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2.5 pr-3 font-medium">{describe(i)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{kg(i.quantity_kg)}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {peso(i.unit_price_per_kg)}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-medium tabular-nums">
                        {peso(i.line_total)}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-500">
                        —
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <dl className="mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{peso(order.subtotal)}</dd>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-slate-600">
                  <dt>Discount ({Number(order.discount_pct ?? 0)}%)</dt>
                  <dd className="tabular-nums">-{peso(discount)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-extrabold">
                <dt>Total due</dt>
                <dd className="tabular-nums">{peso(order.total_amount)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white/70 px-5 py-3.5 dark:border-slate-700 dark:bg-slate-900/70">
          {error && (
            <div
              role="alert"
              className="mb-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-100 dark:ring-rose-800/60"
            >
              <AlertCircle size={14} className="shrink-0 text-rose-600 dark:text-rose-400" />
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">Nothing is invoiced until you generate it.</p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={pending} className="btn-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={onGenerate}
                disabled={pending}
                data-testid="confirm-generate-invoice"
                className="btn-primary"
              >
                <FileText size={15} />
                {pending ? "Generating…" : "Generate invoice"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
