// BillingService — typed API client for tenant billing (Phase F).
import api from "./api";

export class BillingService {
  constructor(private http = api) {}

  getPlans(): Promise<any[]> {
    return this.http.get("/billing/plans").then((r) => r.data);
  }

  getMyRequest(): Promise<any> {
    return this.http.get("/billing/upgrade-requests/mine").then((r) => r.data);
  }

  createUpgradeRequest(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/billing/upgrade-requests", body).then((r) => r.data);
  }

  /** A bank transfer sent with its screenshot (multipart: the fields and "receipt"). */
  createUpgradeRequestWithReceipt(form: FormData): Promise<any> {
    return this.http
      .post("/billing/upgrade-requests/with-receipt", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  }

  cancelUpgradeRequest(id: string): Promise<any> {
    return this.http.delete(`/billing/upgrade-requests/${id}`).then((r) => r.data);
  }

  /** Which online providers are set up: PayMongo (pesos), PayPal (US dollars). */
  getPaymentOptions(): Promise<{ paymongo: boolean; paypal: boolean }> {
    return this.http.get("/billing/payment-options").then((r) => r.data);
  }

  /** Starts paying online; the mill is then sent to checkout_url. */
  startCheckout(body: {
    plan_id: string;
    billing_interval: string;
    provider: string;
    voucher_code?: string;
    current_password?: string;
    mfa_code?: string;
  }): Promise<{ payment_id: string; checkout_url: string }> {
    return this.http.post("/billing/checkout", body).then((r) => r.data);
  }

  /** The payment, as the provider has it now. Paid, the plan is already on. */
  confirmPayment(id: string): Promise<any> {
    return this.http.post(`/billing/payments/${id}/confirm`).then((r) => r.data);
  }
}

export const billingService = new BillingService();

/** What a voucher gives, as the server describes it (backend services/vouchers.py). */
export type VoucherInfo = {
  code: string;
  kind: "free_time" | "percent_off" | "amount_off";
  plan_id: string | null;
  plan_name: string | null;
  billing_interval: "monthly" | "annual" | null;
  percent_off: number | null;
  amount_off: number | null;
  amount_off_usd: number | null;
  free_months: number;
  free_days: number;
  expires_at: string | null;
};

type Totals = { price: number; discount: number; total: number };

export type VoucherCheck = {
  voucher: VoucherInfo;
  /** For the plan and interval asked about: the price, what comes off, what is left. */
  prices: { PHP?: Totals; USD?: Totals } | null;
};

export class VoucherService {
  constructor(private http = api) {}

  /** What a code would give this mill. Changes nothing. */
  check(body: {
    code: string;
    plan_id?: string;
    billing_interval?: string;
  }): Promise<VoucherCheck> {
    return this.http.post("/billing/vouchers/check", body).then((r) => r.data);
  }

  /** Free time on a plan: on at once. The Boss confirms it's them. */
  redeem(body: {
    code: string;
    current_password: string;
    mfa_code?: string;
  }): Promise<{ redeemed: { plan_name: string; expires_at: string } }> {
    return this.http.post("/billing/vouchers/redeem", body).then((r) => r.data);
  }
}

export const voucherService = new VoucherService();
