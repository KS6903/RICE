import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { salesService } from "../services/SalesService";
import LegalNotice from "../components/LegalNotice";
import { inventoryService } from "../services/InventoryService";
import { Plus, Power, History, ChevronDown, ChevronUp, ShoppingCart, FileText } from "lucide-react";
import InvoicePreviewModal, { type PreviewOrder } from "../components/sales/InvoicePreviewModal";
import TruncatedText from "../components/TruncatedText";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import { format } from "date-fns";
import { CUSTOMER_TYPES } from "@rice-mill/shared";
import QuickAdd from "../components/QuickAdd";
import { useAuthStore } from "../stores/authStore";
import { useAccess } from "../hooks/useAccess";
import { useOpenOnArrival } from "../hooks/useOpenOnArrival";
import EmptyState from "../components/EmptyState";
import FieldCaption from "../components/FieldCaption";

type ApiError = { response?: { data?: { detail?: unknown; code?: string } } };

function apiError(error: unknown): { message: string; code?: string } {
  const data = (error as ApiError)?.response?.data;
  return {
    message:
      typeof data?.detail === "string" ? data.detail : "The order couldn't be saved. Try again.",
    code: data?.code,
  };
}

// Prices, quantities and discounts can't be negative: no minus key, and a minus
// that arrives any other way (paste, autofill) is dropped.
const nonNegative = (raw: string) => raw.replace(/-/g, "");
const blockMinus = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "-" || e.key === "e" || e.key === "E") e.preventDefault();
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "badge-gray",
    confirmed: "badge-yellow",
    delivered: "badge-yellow",
    invoiced: "badge-yellow",
    paid: "badge-green",
    overdue: "badge-red",
    unpaid: "badge-red",
    partial: "badge-yellow",
  };
  return <span className={map[status] || "badge-gray"}>{status}</span>;
}

export default function SalesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"orders" | "invoices" | "customers">("orders");
  const { canEdit } = useAccess();
  const [showOrderForm, setShowOrderForm] = useOpenOnArrival();
  useEscapeKey(() => setShowOrderForm(false), showOrderForm);

  const [showCustomerHistory, setShowCustomerHistory] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  useEscapeKey(() => setShowCustomerForm(false), showCustomerForm);
  const [customerForm, setCustomerForm] = useState({
    name: "",
    customer_type: "wholesaler",
    contact_person: "",
    phone: "",
    address: "",
    tin: "",
    credit_limit: "0",
    payment_terms_days: "0",
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () => salesService.listOrders(),
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => salesService.listInvoices(),
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => salesService.listCustomers(true),
  });
  const activeCustomers = customers.filter((c: any) => c.is_active);
  const inactiveCustomers = customers.filter((c: any) => !c.is_active);
  const { data: milled = [], isSuccess: milledLoaded } = useQuery({
    queryKey: ["milled-rice"],
    queryFn: () => inventoryService.getMilledRice(),
  });

  const createCustomer = useMutation({
    mutationFn: (b: typeof customerForm) => salesService.createCustomer(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setShowCustomerForm(false);
      setCustomerForm({
        name: "",
        customer_type: "wholesaler",
        contact_person: "",
        phone: "",
        address: "",
        tin: "",
        credit_limit: "0",
        payment_terms_days: "0",
      });
    },
  });

  const toggleCustomer = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      salesService.setCustomerActive(id, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });

  const [orderForm, setOrderForm] = useState({
    customer_id: "",
    order_date: format(new Date(), "yyyy-MM-dd"),
    discount_pct: "0",
    remarks: "",
    items: [
      {
        item_type: "milled_rice",
        variety_id: "",
        grade_name: "regular",
        quantity_kg: "",
        unit_price_per_kg: "",
      },
    ],
  });

  const createOrder = useMutation({
    mutationFn: (body: typeof orderForm & { approve_over_limit?: boolean }) =>
      salesService.createOrder(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      setShowOrderForm(false);
    },
  });
  const orderError = createOrder.isError ? apiError(createOrder.error) : null;
  // The credit-limit guard (Enterprise automations) may stop an order; owners
  // and admins can approve it anyway.
  const role = useAuthStore((s) => s.user?.role);
  const canApprove = role === "owner" || role === "admin";

  // The order whose invoice is being previewed; generating happens from there.
  const [previewOrder, setPreviewOrder] = useState<PreviewOrder | null>(null);
  const createInvoice = useMutation({
    mutationFn: (order_id: string) => salesService.createInvoice(order_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      setPreviewOrder(null);
    },
  });
  const invoiceError = createInvoice.isError
    ? (((createInvoice.error as ApiError)?.response?.data?.detail as string | undefined) ??
      "The invoice couldn't be generated. Try again.")
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Sales</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Orders, invoices, and customer management
          </p>
        </div>
        {tab === "orders" && (
          <button onClick={() => setShowOrderForm(!showOrderForm)} className="btn-primary shrink-0">
            <Plus size={16} /> New Order
          </button>
        )}
        {tab === "customers" && (
          <button onClick={() => setShowCustomerForm(!showCustomerForm)} className="btn-primary shrink-0">
            <Plus size={16} /> New Customer
          </button>
        )}
      </div>

      {showOrderForm && tab === "orders" && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">New Sales Order</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">
                  Customer
                </label>
                <QuickAdd
                  label="New customer"
                  endpoint="/sales/customers"
                  queryKey={["customers"]}
                  fields={[
                    { key: "name", label: "Name", required: true, full: true },
                    {
                      key: "customer_type",
                      label: "Type",
                      type: "select",
                      options: CUSTOMER_TYPES.map((t) => ({ value: t.value, label: t.label })),
                      default: "wholesaler",
                    },
                    { key: "phone", label: "Phone" },
                    {
                      key: "credit_limit",
                      label: "Credit limit (₱)",
                      type: "number",
                      default: "0",
                    },
                    {
                      key: "payment_terms_days",
                      label: "Payment terms (days)",
                      type: "number",
                      default: "0",
                    },
                  ]}
                  transformBody={(b) => ({
                    ...b,
                    credit_limit: parseFloat(b.credit_limit || "0"),
                    payment_terms_days: parseInt(b.payment_terms_days || "0"),
                  })}
                  onCreated={(c) => setOrderForm((f) => ({ ...f, customer_id: c.id }))}
                />
              </div>
              <Select
                aria-label="Customer"
                placeholder="Select customer…"
                value={orderForm.customer_id}
                onChange={(v) => setOrderForm((f) => ({ ...f, customer_id: v }))}
                options={activeCustomers.map((c: any) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Order Date
              </label>
              <DatePicker
                aria-label="Order date"
                value={orderForm.order_date}
                onChange={(v) => setOrderForm((f) => ({ ...f, order_date: v }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Discount %
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                className="input"
                value={orderForm.discount_pct}
                onKeyDown={blockMinus}
                onChange={(e) =>
                  setOrderForm((f) => ({ ...f, discount_pct: nonNegative(e.target.value) }))
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-slate-200">Order Items</p>
              <button
                onClick={() =>
                  setOrderForm((f) => ({
                    ...f,
                    items: [
                      ...f.items,
                      {
                        item_type: "milled_rice",
                        variety_id: "",
                        grade_name: "regular",
                        quantity_kg: "",
                        unit_price_per_kg: "",
                      },
                    ],
                  }))
                }
                className="text-sm text-brand-600 dark:text-brand-400"
              >
                + Add
              </button>
            </div>
            {orderForm.items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <FieldCaption label="Rice in stock" className="col-span-2 sm:col-span-1">
                  <Select
                    aria-label="Rice in stock"
                    placeholder="Variety"
                    value={
                      (
                        milled.find(
                          (m: any) =>
                            m.variety_id === item.variety_id && m.grade_name === item.grade_name,
                        ) ?? milled.find((m: any) => m.variety_id === item.variety_id)
                      )?.id ?? ""
                    }
                    onChange={(stockId) => {
                      const stock = milled.find((m: any) => m.id === stockId);
                      if (!stock) return;
                      const items = [...orderForm.items];
                      items[idx] = {
                        ...items[idx],
                        variety_id: stock.variety_id,
                        grade_name: stock.grade_name ?? items[idx].grade_name,
                      };
                      setOrderForm((f) => ({ ...f, items }));
                    }}
                    options={milled.map((m: any) => ({
                      value: m.id,
                      label: `${m.variety?.code ?? "Rice"} (${m.grade_name})`,
                    }))}
                  />
                </FieldCaption>
                <FieldCaption label="Quantity (kg)">
                  <input
                    className="input"
                    placeholder="Qty kg"
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity_kg}
                    onKeyDown={blockMinus}
                    onChange={(e) => {
                      const items = [...orderForm.items];
                      items[idx].quantity_kg = nonNegative(e.target.value);
                      setOrderForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label="Price per kg (₱)">
                  <input
                    className="input"
                    placeholder="₱/kg"
                    type="number"
                    min="0"
                    step="any"
                    value={item.unit_price_per_kg}
                    onKeyDown={blockMinus}
                    onChange={(e) => {
                      const items = [...orderForm.items];
                      items[idx].unit_price_per_kg = nonNegative(e.target.value);
                      setOrderForm((f) => ({ ...f, items }));
                    }}
                  />
                </FieldCaption>
                <FieldCaption label="Amount" className="col-span-2 sm:col-span-1">
                  <span className="input block bg-gray-50 dark:bg-slate-900/50 text-gray-600 dark:text-slate-300">
                    ₱
                    {item.quantity_kg && item.unit_price_per_kg
                      ? (
                          parseFloat(item.quantity_kg) * parseFloat(item.unit_price_per_kg)
                        ).toLocaleString()
                      : "0"}
                  </span>
                </FieldCaption>
              </div>
            ))}
            {milledLoaded && milled.length === 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                You have no milled rice in stock to sell yet.{" "}
                <Link to="/milling?new=1" className="font-medium underline">
                  Mill a batch first
                </Link>
                ; the rice it produces will show up here.
              </p>
            )}
          </div>
          {orderError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3 space-y-2"
            >
              <p className="text-sm text-rose-700 dark:text-rose-300">{orderError.message}</p>
              {orderError.code === "over_credit_limit" && canApprove && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => createOrder.mutate({ ...orderForm, approve_over_limit: true })}
                  disabled={createOrder.isPending}
                >
                  Approve over the limit
                </button>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowOrderForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => createOrder.mutate(orderForm)}
              className="btn-primary"
              disabled={createOrder.isPending || !orderForm.customer_id}
              title={orderForm.customer_id ? undefined : "Choose the customer first"}
            >
              {createOrder.isPending ? "Saving…" : "Create Order"}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
        {(["orders", "invoices", "customers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "orders" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {["Order No.", "Date", "Customer", "Total", "Status", "Action"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {orders.map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3 font-mono text-xs">{o.order_no}</td>
                  <td className="px-4 py-3">{o.order_date}</td>
                  <td className="px-4 py-3">
                    {o.customer?.name ? (
                      <TruncatedText
                        text={o.customer.name}
                        className="max-w-[10rem] sm:max-w-[16rem]"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    ₱{Number(o.total_amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    {o.status === "confirmed" && canEdit("sales") && (
                      <button
                        type="button"
                        onClick={() => {
                          createInvoice.reset();
                          setPreviewOrder(o);
                        }}
                        data-testid={`generate-invoice-${o.id}`}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 hover:ring-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-800/60 dark:hover:bg-emerald-950/50"
                      >
                        <FileText size={14} />
                        Generate invoice
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={ShoppingCart}
                      title="No sales yet"
                      action={canEdit("sales") ? "Create your first order" : undefined}
                      onAction={() => setShowOrderForm(true)}
                      next="Once an order is confirmed, use Generate Invoice to bill the customer."
                    >
                      An order is what a customer is buying: which rice, how many kilos, at what
                      price. You can add a new customer right from the order form.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {tab === "invoices" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
              <tr>
                {["Invoice No.", "Date", "Due Date", "Total", "Paid", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoice_no}</td>
                  <td className="px-4 py-3">{inv.invoice_date}</td>
                  <td className="px-4 py-3">{inv.due_date || "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    ₱{Number(inv.total_amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">₱{Number(inv.paid_amount).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No invoices yet. Create one from a confirmed order on the Orders tab with
                    Generate Invoice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {tab === "invoices" && <LegalNotice kind="invoice" className="px-1" />}

      {previewOrder && (
        <InvoicePreviewModal
          order={previewOrder}
          onClose={() => setPreviewOrder(null)}
          onGenerate={() => createInvoice.mutate(previewOrder.id)}
          pending={createInvoice.isPending}
          error={invoiceError}
        />
      )}

      {tab === "customers" && (
        <>
          {showCustomerForm && (
            <div className="card space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-slate-100">New customer</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Name *
                  </label>
                  <input
                    className="input"
                    value={customerForm.name}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Type
                  </label>
                  <Select
                    aria-label="Customer type"
                    value={customerForm.customer_type}
                    onChange={(v) => setCustomerForm((f) => ({ ...f, customer_type: v }))}
                    options={CUSTOMER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Contact person
                  </label>
                  <input
                    className="input"
                    value={customerForm.contact_person}
                    onChange={(e) =>
                      setCustomerForm((f) => ({ ...f, contact_person: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Phone
                  </label>
                  <input
                    className="input"
                    value={customerForm.phone}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Address
                  </label>
                  <input
                    className="input"
                    value={customerForm.address}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, address: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    TIN
                  </label>
                  <input
                    className="input"
                    value={customerForm.tin}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, tin: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Credit limit (₱)
                  </label>
                  <input
                    className="input"
                    type="number"
                    value={customerForm.credit_limit}
                    onChange={(e) =>
                      setCustomerForm((f) => ({ ...f, credit_limit: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                    Payment terms (days)
                  </label>
                  <input
                    className="input"
                    type="number"
                    value={customerForm.payment_terms_days}
                    onChange={(e) =>
                      setCustomerForm((f) => ({ ...f, payment_terms_days: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCustomerForm(false)} className="btn-secondary">
                  Cancel
                </button>
                <button
                  onClick={() => createCustomer.mutate(customerForm)}
                  className="btn-primary"
                  disabled={createCustomer.isPending || !customerForm.name}
                >
                  {createCustomer.isPending ? "Saving…" : "Save customer"}
                </button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
                <tr>
                  {["Name", "Type", "Phone", "Credit Limit", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {activeCustomers.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 capitalize">
                      {c.customer_type?.replace("_", " ") || "—"}
                    </td>
                    <td className="px-4 py-3">{c.phone || "—"}</td>
                    <td className="px-4 py-3">₱{Number(c.credit_limit).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="badge-green">Active</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleCustomer.mutate({ id: c.id, is_active: false })}
                        className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 inline-flex items-center gap-1"
                      >
                        <Power size={12} /> Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
                {activeCustomers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">
                      No customers yet. Add one with New Customer, or straight from a new order.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {inactiveCustomers.length > 0 && (
              <div className="border-t border-gray-200 dark:border-slate-700 bg-gray-50/50">
                <button
                  onClick={() => setShowCustomerHistory(!showCustomerHistory)}
                  className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <History size={14} />
                    Deactivated history ({inactiveCustomers.length})
                  </span>
                  {showCustomerHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showCustomerHistory && (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                      {inactiveCustomers.map((c: any) => (
                        <tr
                          key={c.id}
                          className="hover:bg-gray-50 dark:hover:bg-slate-900/50 opacity-60"
                        >
                          <td className="px-4 py-3 font-medium">{c.name}</td>
                          <td className="px-4 py-3 capitalize">
                            {c.customer_type?.replace("_", " ") || "—"}
                          </td>
                          <td className="px-4 py-3">{c.phone || "—"}</td>
                          <td className="px-4 py-3">₱{Number(c.credit_limit).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <span className="badge-red">Inactive</span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleCustomer.mutate({ id: c.id, is_active: true })}
                              className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 inline-flex items-center gap-1"
                            >
                              <Power size={12} /> Activate
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
