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
}

export const billingService = new BillingService();
