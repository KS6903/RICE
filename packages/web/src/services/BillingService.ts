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
  }): Promise<{ payment_id: string; checkout_url: string }> {
    return this.http.post("/billing/checkout", body).then((r) => r.data);
  }

  /** The payment, as the provider has it now. Paid, the plan is already on. */
  confirmPayment(id: string): Promise<any> {
    return this.http.post(`/billing/payments/${id}/confirm`).then((r) => r.data);
  }
}

export const billingService = new BillingService();
