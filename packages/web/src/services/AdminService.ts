// AdminService — typed API client for the platform-admin domain (Phase F).
// One service for all /admin/* endpoints the admin pages use.
import api from "./api";
import type { BackupSummary } from "./DataExportService";
import type { TemporaryPassword } from "./UsersService";

/** Whether a backup can be loaded into the tenant, and the email a file is
 *  opened with unless another is given. */
export type TenantBackupStatus = {
  empty: boolean;
  has_boss: boolean;
  owner_email: string | null;
};

// The client sends JSON by default, which would turn a FormData into JSON.
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

function backupForm(file: File, email: string): FormData {
  const form = new FormData();
  form.append("file", file);
  if (email.trim()) form.append("email", email.trim());
  return form;
}

type LedgerUser = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  role: string | null;
};

/** One "I agree" click: which bundle version, the hash of the text shown, how and where. */
export type LegalAcceptanceRow = LedgerUser & {
  id: string;
  agreement_version: string;
  content_hash: string;
  documents: { key: string; version: string; effective_date: string; sha256: string }[];
  method: "signup" | "gate" | "invite" | string;
  ip_address: string | null;
  user_agent: string | null;
  accepted_at: string;
};

export type TenantLegalAcceptances = {
  agreement_version: string;
  acceptances: LegalAcceptanceRow[];
  /** Active users who haven't accepted the current version yet. */
  not_accepted_current: LedgerUser[];
};

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

  // ── payment accounts (where mills pay for each plan) ────────────────────────
  updatePaymentAccount(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/admin/plans/${id}/payment-account`, body).then((r) => r.data);
  }
  uploadPaymentQr(id: string, file: File): Promise<any> {
    const form = new FormData();
    form.append("file", file);
    return this.http.post(`/admin/plans/${id}/payment-qr`, form, MULTIPART).then((r) => r.data);
  }
  removePaymentQr(id: string): Promise<any> {
    return this.http.delete(`/admin/plans/${id}/payment-qr`).then((r) => r.data);
  }

  // ── tenants ─────────────────────────────────────────────────────────────────
  getTenants(): Promise<any[]> {
    return this.http.get("/admin/tenants").then((r) => r.data);
  }
  getTenant(id: string): Promise<any> {
    return this.http.get(`/admin/tenants/${id}`).then((r) => r.data);
  }
  retryProvisioning(id: string): Promise<any> {
    return this.http.post(`/admin/tenants/${id}/provisioning/retry`).then((r) => r.data);
  }
  getTenantActivity(id: string): Promise<any[]> {
    return this.http.get(`/admin/tenants/${id}/activity`).then((r) => r.data);
  }
  /** Read-only: the tenant's agreement-acceptance ledger, for the platform's records. */
  getTenantLegalAcceptances(id: string): Promise<TenantLegalAcceptances> {
    return this.http.get(`/admin/tenants/${id}/legal-acceptances`).then((r) => r.data);
  }
  getTenantSubscription(id: string): Promise<any> {
    return this.http.get(`/admin/tenants/${id}/subscription`).then((r) => r.data);
  }
  setTenantActive(id: string, isActive: boolean): Promise<any> {
    return this.http
      .put(`/admin/tenants/${id}/active`, { is_active: isActive })
      .then((r) => r.data);
  }
  assignTenantSubscription(id: string, body: Record<string, unknown>): Promise<any> {
    return this.http.put(`/admin/tenants/${id}/subscription`, body).then((r) => r.data);
  }

  // ── loading a backup into an empty tenant ───────────────────────────────────
  getTenantBackupStatus(id: string): Promise<TenantBackupStatus> {
    return this.http.get(`/admin/tenants/${id}/backup/status`).then((r) => r.data);
  }
  /** What the file holds and whether it would load. Changes nothing. */
  inspectTenantBackup(id: string, file: File, email: string): Promise<BackupSummary> {
    return this.http
      .post(`/admin/tenants/${id}/backup/inspect`, backupForm(file, email), MULTIPART)
      .then((r) => r.data);
  }
  restoreTenantBackup(id: string, file: File, email: string): Promise<BackupSummary> {
    return this.http
      .post(`/admin/tenants/${id}/backup/restore`, backupForm(file, email), MULTIPART)
      .then((r) => r.data);
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
    return this.http
      .get(`/admin/upgrade-requests?status_filter=${statusFilter}`)
      .then((r) => r.data);
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

  /** Give a locked-out user (usually a Boss who emailed for help) a temporary password. */
  issueTemporaryPassword(id: string): Promise<TemporaryPassword> {
    return this.http.post(`/admin/users/${id}/temporary-password`).then((r) => r.data);
  }
}

export const adminService = new AdminService();
