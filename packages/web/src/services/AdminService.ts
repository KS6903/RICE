// AdminService — typed API client for the platform-admin domain (Phase F).
// One service for all /admin/* endpoints the admin pages use.
import api from "./api";

export class AdminService {
  constructor(private http = api) {}

  // ── dashboard / stats ───────────────────────────────────────────────────────
  getStats(): Promise<any> {
    return this.http.get("/admin/stats").then((r) => r.data);
  }
  getSignupsTrend(days = 30): Promise<any[]> {
    return this.http.get(`/admin/signups-trend?days=${days}`).then((r) => r.data);
  }
  getPendingCount(): Promise<any> {
    return this.http.get("/admin/upgrade-requests/pending-count").then((r) => r.data);
  }

  // ── plans ───────────────────────────────────────────────────────────────────
  getPlans(): Promise<any[]> {
    return this.http.get("/admin/plans").then((r) => r.data);
  }
  createPlan(body: Record<string, unknown>): Promise<any> {
    return this.http.post("/admin/plans", body).then((r) => r.data);
  }
  updatePlan(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/admin/plans/${id}`, body).then((r) => r.data);
  }
  deletePlan(id: string): Promise<any> {
    return this.http.delete(`/admin/plans/${id}`).then((r) => r.data);
  }

  // ── tenants ─────────────────────────────────────────────────────────────────
  getTenants(): Promise<any[]> {
    return this.http.get("/admin/tenants").then((r) => r.data);
  }
  getTenant(id: string): Promise<any> {
    return this.http.get(`/admin/tenants/${id}`).then((r) => r.data);
  }
  getTenantActivity(id: string): Promise<any[]> {
    return this.http.get(`/admin/tenants/${id}/activity`).then((r) => r.data);
  }
  getTenantSubscription(id: string): Promise<any> {
    return this.http.get(`/admin/tenants/${id}/subscription`).then((r) => r.data);
  }
  setTenantActive(id: string, isActive: boolean): Promise<any> {
    return this.http.put(`/admin/tenants/${id}/active`, { is_active: isActive }).then((r) => r.data);
  }
  assignTenantSubscription(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/admin/tenants/${id}/subscription`, body).then((r) => r.data);
  }

  // ── subscription maintenance ────────────────────────────────────────────────
  getMissingCount(): Promise<any> {
    return this.http.get("/admin/subscriptions/missing-count").then((r) => r.data);
  }
  backfillFree(): Promise<any> {
    return this.http.post("/admin/subscriptions/backfill-free").then((r) => r.data);
  }
  sweepExpired(): Promise<any> {
    return this.http.post("/admin/subscriptions/sweep-expired").then((r) => r.data);
  }

  // ── upgrade requests ────────────────────────────────────────────────────────
  listUpgradeRequests(statusFilter: string): Promise<any[]> {
    return this.http.get(`/admin/upgrade-requests?status_filter=${statusFilter}`).then((r) => r.data);
  }
  approveRequest(id: string, body: Record<string, unknown> = {}): Promise<any> {
    return this.http.post(`/admin/upgrade-requests/${id}/approve`, body).then((r) => r.data);
  }
  rejectRequest(id: string, body: Record<string, unknown> = {}): Promise<any> {
    return this.http.post(`/admin/upgrade-requests/${id}/reject`, body).then((r) => r.data);
  }

  // ── users ───────────────────────────────────────────────────────────────────
  listAllUsers(): Promise<any[]> {
    return this.http.get("/admin/users").then((r) => r.data);
  }
}

export const adminService = new AdminService();
