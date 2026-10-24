// SalesService — typed API client for the sales domain (Phase F).
import api from "./api";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export class SalesService {
  constructor(private http = api) {}

  // ── reads ──────────────────────────────────────────────────────────────────

  /** Orders, newest first; with `itemType`, only those that sell it (palay,
   *  milled_rice, byproduct), as the Buy & mill pages list them. */
  listOrders(itemType?: string): Promise<any[]> {
    return this.http
      .get("/sales/orders", itemType ? { params: { item_type: itemType } } : undefined)
      .then((r) => r.data);
  }

  listInvoices(): Promise<any[]> {
    return this.http.get("/sales/invoices").then((r) => r.data);
  }

  listCustomers(includeInactive = true): Promise<any[]> {
    return this.http
      .get(`/sales/customers?include_inactive=${includeInactive}`)
      .then((r) => r.data);
  }

  // ── customers ──────────────────────────────────────────────────────────────

  /** Parse the credit/terms numbers. Pure. */
  static toCustomerPayload(form: Record<string, any>) {
    return {
      ...form,
      credit_limit: parseFloat(form.credit_limit) || 0,
      payment_terms_days: parseInt(form.payment_terms_days) || 0,
    };
  }

  createCustomer(form: Record<string, any>): Promise<any> {
    return this.http
      .post("/sales/customers", SalesService.toCustomerPayload(form))
      .then((r) => r.data);
  }

  setCustomerActive(id: string, isActive: boolean): Promise<any> {
    return this.http.put(`/sales/customers/${id}`, { is_active: isActive }).then((r) => r.data);
  }

  // ── orders / invoices ──────────────────────────────────────────────────────

  /** Parse discount + line-item numbers and null empty variety ids. Pure. */
  static toOrderPayload(form: Record<string, any>) {
    return {
      ...form,
      discount_pct: parseFloat(form.discount_pct) || 0,
      items: form.items.map((i: Record<string, any>) => ({
        ...i,
        quantity_kg: parseFloat(i.quantity_kg),
        unit_price_per_kg: parseFloat(i.unit_price_per_kg),
        variety_id: i.variety_id || null,
      })),
    };
  }

  createOrder(form: Record<string, any>): Promise<any> {
    return this.http.post("/sales/orders", SalesService.toOrderPayload(form)).then((r) => r.data);
  }

  createInvoice(orderId: string): Promise<any> {
    return this.http
      .post("/sales/invoices", { order_id: orderId, invoice_date: todayISO() })
      .then((r) => r.data);
  }

  // ── corrections (the Boss) and each record's change history ────────────────

  /** Correct a saved order: only the fields sent change; items replace its lines. */
  editOrder(id: string, body: OrderEdit): Promise<any> {
    return this.http.patch(`/sales/orders/${id}`, body).then((r) => r.data);
  }

  /** Correct a saved invoice's dates. Its amounts follow its order. */
  editInvoice(id: string, body: { invoice_date?: string; due_date?: string | null }): Promise<any> {
    return this.http.patch(`/sales/invoices/${id}`, body).then((r) => r.data);
  }

  updateCustomer(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/sales/customers/${id}`, body).then((r) => r.data);
  }

  /** Every logged change to one record, newest first. */
  history(kind: RecordKind, id: string): Promise<ChangeEntry[]> {
    return this.http.get(`/sales/history/${kind}/${id}`).then((r) => r.data);
  }
}

export type RecordKind = "sales_order" | "invoice" | "customer";

export type ChangeEntry = {
  id: string;
  action: string;
  user_name: string | null;
  detail: string | null;
  created_at: string | null;
};

export type OrderEdit = {
  customer_id?: string;
  order_date?: string;
  delivery_date?: string | null;
  discount_pct?: number;
  remarks?: string | null;
  items?: {
    item_type: string;
    variety_id: string | null;
    grade_name: string | null;
    byproduct_type: string | null;
    quantity_kg: number;
    unit_price_per_kg: number;
  }[];
};

export const salesService = new SalesService();
