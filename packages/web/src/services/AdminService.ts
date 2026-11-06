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

export type ViewAsMode = "view" | "full";

export type ReleaseStage = "bossadmin" | "enterprise" | "pro" | "basic" | "everyone";

export type PageDirectory = {
  stages: ReleaseStage[];
  always_on: string[];
  pages: {
    section: string;
    stage: ReleaseStage;
    code_stage: ReleaseStage;
    turned_on_for: { id: string; name: string }[];
    turned_off_for: { id: string; name: string }[];
  }[];
};

export type VoucherKind = "free_time" | "percent_off" | "amount_off";

export type AdminVoucher = {
  id: string;
  code: string;
  raw_code: string;
  kind: VoucherKind;
  plan_id: string | null;
  plan_name: string | null;
  billing_interval: "monthly" | "annual" | null;
  percent_off: number | null;
  amount_off: number | null;
  amount_off_usd: number | null;
  free_months: number;
  free_days: number;
  company_id: string | null;
  company_name: string | null;
  max_uses: number | null;
  uses: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string | null;
};

export type AuditRow = {
  id: string;
  admin_username: string;
  action: string;
  method: string | null;
  path: string | null;
  company_id: string | null;
  company_name: string | null;
  detail: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export class AdminService {
  constructor(private http = api) {}

  // ── confirming before changes, and "View as" ────────────────────────────────
  confirmStatus(): Promise<{
    confirmed_until: string | null;
    uses_code: boolean;
    minutes: number;
  }> {
    return this.http.get("/admin/confirm").then((r) => r.data);
  }
  /** Close the confirmation window now. */
  endConfirmation(): Promise<unknown> {
    return this.http.delete("/admin/confirm").then((r) => r.data);
  }
  startViewAs(body: {
    user_id: string;
    mode: ViewAsMode;
    current_password?: string;
    mfa_code?: string;
  }): Promise<{ mode: ViewAsMode; expires_at: string; company_name: string }> {
    return this.http.post("/admin/view-as", body).then((r) => r.data);
  }

  // ── page directory: release stages and per-mill switches ────────────────────
  getPages(): Promise<PageDirectory> {
    return this.http.get("/admin/pages").then((r) => r.data);
  }
  setPageStage(section: string, stage: ReleaseStage): Promise<PageDirectory> {
    return this.http.put(`/admin/pages/${section}`, { stage }).then((r) => r.data);
  }
  setTenantPage(
    tenantId: string,
    section: string,
    value: "on" | "off" | "default",
  ): Promise<{ page_overrides: Record<string, "on" | "off"> }> {
    return this.http
      .put(`/admin/tenants/${tenantId}/pages`, { section, value })
      .then((r) => r.data);
  }

  // ── vouchers ────────────────────────────────────────────────────────────────
  listVouchers(): Promise<AdminVoucher[]> {
    return this.http.get("/admin/vouchers").then((r) => r.data);
  }
  createVoucher(body: Record<string, unknown>): Promise<AdminVoucher> {
    return this.http.post("/admin/vouchers", body).then((r) => r.data);
  }
  updateVoucher(id: string, body: Record<string, unknown>): Promise<AdminVoucher> {
    return this.http.patch(`/admin/vouchers/${id}`, body).then((r) => r.data);
  }
  deleteVoucher(id: string): Promise<unknown> {
    return this.http.delete(`/admin/vouchers/${id}`).then((r) => r.data);
  }
  voucherUses(id: string): Promise<
    {
      company_id: string | null;
      company_name: string;
      currency: string | null;
      discount: number;
      created_at: string;
    }[]
  > {
    return this.http.get(`/admin/vouchers/${id}/uses`).then((r) => r.data);
  }
  tenantNames(): Promise<{ id: string; name: string }[]> {
    return this.http.get("/admin/tenant-names").then((r) => r.data);
  }

  // ── BossAdmin's own audit log ───────────────────────────────────────────────
  auditLog(companyId?: string): Promise<AuditRow[]> {
    return this.http
      .get("/admin/audit-log", { params: companyId ? { company_id: companyId } : {} })
      .then((r) => r.data);
  }

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
