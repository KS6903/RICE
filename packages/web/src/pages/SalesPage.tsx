import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { salesService } from "../services/SalesService";
import LegalNotice from "../components/LegalNotice";
import { inventoryService } from "../services/InventoryService";
import { Plus, Power, History, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { CUSTOMER_TYPES } from "@rice-mill/shared";
import QuickAdd from "../components/QuickAdd";
import { useAuthStore } from "../stores/authStore";

type ApiError = { response?: { data?: { detail?: unknown; code?: string } } };

function apiError(error: unknown): { message: string; code?: string } {
  const data = (error as ApiError)?.response?.data;
  return {
    message:
      typeof data?.detail === "string" ? data.detail : "The order couldn't be saved. Try again.",
    code: data?.code,
  };
}

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
  const [showOrderForm, setShowOrderForm] = useState(false);

  const [showCustomerHistory, setShowCustomerHistory] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
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
  const { data: milled = [] } = useQuery({
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

  const createInvoice = useMutation({
    mutationFn: (order_id: string) => salesService.createInvoice(order_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Sales</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Orders, invoices, and customer management
          </p>
        </div>
        {tab === "orders" && (
          <button onClick={() => setShowOrderForm(!showOrderForm)} className="btn-primary">
            <Plus size={16} /> New Order
          </button>
        )}
        {tab === "customers" && (
          <button onClick={() => setShowCustomerForm(!showCustomerForm)} className="btn-primary">
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
              <select
                className="input"
                value={orderForm.customer_id}
                onChange={(e) => setOrderForm((f) => ({ ...f, customer_id: e.target.value }))}
              >
                <option value="">Select customer…</option>
                {activeCustomers.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Order Date
              </label>
              <input
                type="date"
                className="input"
                value={orderForm.order_date}
                onChange={(e) => setOrderForm((f) => ({ ...f, order_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                Discount %
              </label>
              <input
                type="number"
                className="input"
                value={orderForm.discount_pct}
                onChange={(e) => setOrderForm((f) => ({ ...f, discount_pct: e.target.value }))}
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
              <div key={idx} className="grid grid-cols-5 gap-2">
                <select
                  className="input"
                  value={item.variety_id}
                  onChange={(e) => {
                    const items = [...orderForm.items];
                    items[idx].variety_id = e.target.value;
                    setOrderForm((f) => ({ ...f, items }));
                  }}
                >
                  <option value="">Variety</option>
                  {milled.map((m: any) => (
                    <option key={m.id} value={m.variety_id}>
                      {m.variety?.code} ({m.grade_name})
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder="Qty kg"
                  type="number"
                  value={item.quantity_kg}
                  onChange={(e) => {
                    const items = [...orderForm.items];
                    items[idx].quantity_kg = e.target.value;
                    setOrderForm((f) => ({ ...f, items }));
                  }}
                />
                <input
                  className="input"
                  placeholder="₱/kg"
                  type="number"
                  value={item.unit_price_per_kg}
                  onChange={(e) => {
                    const items = [...orderForm.items];
                    items[idx].unit_price_per_kg = e.target.value;
                    setOrderForm((f) => ({ ...f, items }));
                  }}
                />
                <span className="input bg-gray-50 dark:bg-slate-900/50 text-gray-600 dark:text-slate-300">
                  ₱
                  {item.quantity_kg && item.unit_price_per_kg
                    ? (
                        parseFloat(item.quantity_kg) * parseFloat(item.unit_price_per_kg)
                      ).toLocaleString()
                    : "0"}
                </span>
              </div>
            ))}
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
              disabled={createOrder.isPending}
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
                  <td className="px-4 py-3">{o.customer?.name || "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    ₱{Number(o.total_amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    {o.status === "confirmed" && (
                      <button
                        onClick={() => createInvoice.mutate(o.id)}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                      >
                        Generate Invoice
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No sales orders yet
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
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No invoices yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {tab === "invoices" && <LegalNotice kind="invoice" className="px-1" />}

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
                  <select
                    className="input"
                    value={customerForm.customer_type}
                    onChange={(e) =>
                      setCustomerForm((f) => ({ ...f, customer_type: e.target.value }))
                    }
                  >
                    {CUSTOMER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
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
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      No active customers
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
