import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import RecordDialog from "./RecordDialog";
import Select from "../Select";
import DatePicker from "../DatePicker";
import { salesService } from "../../services/SalesService";
import { byproductLabel } from "../../mappers/byproductNames";

type Line = {
  item_type: string;
  variety_id: string | null;
  variety_code?: string | null;
  grade_name: string | null;
  byproduct_type: string | null;
  quantity_kg: string;
  unit_price_per_kg: string;
};

const lineName = (l: Line) =>
  l.item_type === "byproduct"
    ? (l.byproduct_type && byproductLabel(l.byproduct_type)) || "By-product"
    : [l.variety_code, l.grade_name].filter(Boolean).join(" ") || l.item_type.replace("_", " ");

const peso = (n: number) =>
  `₱${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The Boss corrects a saved order. Every changed field is logged, and the
 *  order's invoice follows the new total. */
export default function EditOrderDialog({
  order,
  customers,
  onClose,
}: {
  order: any;
  customers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState<string>(order.customer_id ?? "");
  const [orderDate, setOrderDate] = useState<string>(order.order_date ?? "");
  const [deliveryDate, setDeliveryDate] = useState<string>(order.delivery_date ?? "");
  const [discount, setDiscount] = useState<string>(String(Number(order.discount_pct ?? 0)));
  const [remarks, setRemarks] = useState<string>(order.remarks ?? "");
  const [lines, setLines] = useState<Line[]>(
    (order.items ?? []).map((i: any) => ({
      item_type: i.item_type,
      variety_id: i.variety_id ?? null,
      variety_code: i.variety_code ?? null,
      grade_name: i.grade_name ?? null,
      byproduct_type: i.byproduct_type ?? null,
      quantity_kg: String(Number(i.quantity_kg)),
      unit_price_per_kg: String(Number(i.unit_price_per_kg)),
    })),
  );

  const subtotal = lines.reduce(
    (sum, l) => sum + (parseFloat(l.quantity_kg) || 0) * (parseFloat(l.unit_price_per_kg) || 0),
    0,
  );
  const total = subtotal - subtotal * ((parseFloat(discount) || 0) / 100);
  const valid =
    !!customerId &&
    !!orderDate &&
    lines.length > 0 &&
    lines.every((l) => parseFloat(l.quantity_kg) > 0 && parseFloat(l.unit_price_per_kg) >= 0);

  const save = useMutation({
    mutationFn: () =>
      salesService.editOrder(order.id, {
        customer_id: customerId,
        order_date: orderDate,
        delivery_date: deliveryDate || null,
        discount_pct: parseFloat(discount) || 0,
        remarks: remarks.trim() || null,
        items: lines.map((l) => ({
          item_type: l.item_type,
          variety_id: l.variety_id,
          grade_name: l.grade_name,
          byproduct_type: l.byproduct_type,
          quantity_kg: parseFloat(l.quantity_kg),
          unit_price_per_kg: parseFloat(l.unit_price_per_kg),
        })),
      }),
    onSuccess: () => {
      for (const key of ["sales-orders", "invoices", "record-history"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });
  const error = (save.error as any)?.response?.data?.detail;

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const options = customers.some((c) => c.id === customerId)
    ? customers
    : [...customers, { id: customerId, name: order.customer?.name ?? "This customer" }];

  return (
    <RecordDialog
      title={`Edit order ${order.order_no}`}
      subtitle="Every change you save is logged in the order's history."
      onClose={onClose}
      busy={save.isPending}
      testId="edit-order"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={!valid || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block sm:col-span-2">
            <span className="block mb-1 text-xs font-medium text-secondary">Customer</span>
            <Select
              aria-label="Customer"
              value={customerId}
              onChange={setCustomerId}
              options={options.map((c) => ({ value: c.id, label: c.name }))}
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">Order date</span>
            <DatePicker value={orderDate} onChange={setOrderDate} aria-label="Order date" />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">Delivery date</span>
            <DatePicker
              value={deliveryDate}
              onChange={setDeliveryDate}
              aria-label="Delivery date"
              clearable
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-xs font-medium text-secondary">Discount %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </label>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-secondary">Lines</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
                <p className="pb-2 text-sm font-medium text-primary truncate">{lineName(l)}</p>
                <label className="block">
                  <span className="block mb-1 text-[11px] text-muted">Kilos</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    aria-label={`Kilos of ${lineName(l)}`}
                    value={l.quantity_kg}
                    onChange={(e) => setLine(i, { quantity_kg: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="block mb-1 text-[11px] text-muted">₱ per kg</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    aria-label={`Price per kg of ${lineName(l)}`}
                    value={l.unit_price_per_kg}
                    onChange={(e) => setLine(i, { unit_price_per_kg: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost !p-2 mb-0.5"
                  aria-label={`Remove ${lineName(l)}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-right text-sm text-secondary">
            New total: <span className="font-semibold text-primary">{peso(total)}</span>
          </p>
        </div>

        <label className="block">
          <span className="block mb-1 text-xs font-medium text-secondary">Remarks</span>
          <textarea
            className="input min-h-[4rem]"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {typeof error === "string" ? error : "Couldn't save. Check the fields and try again."}
          </p>
        )}
      </div>
    </RecordDialog>
  );
}
