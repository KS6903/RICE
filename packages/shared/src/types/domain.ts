// Core domain types shared between web, desktop, and backend

export type Role = "owner" | "admin" | "mill_operator" | "accountant" | "cashier" | "encoder";

export interface User {
  id: string;
  username: string;
  full_name: string;
  email?: string;
  role: Role | null;
  company_id: string | null;
  branch_id?: string | null;
  is_platform_admin?: boolean;
  features?: string[];
  mfa_enabled?: boolean;
  mfa_backup_codes_remaining?: number;
  mfa_setup_recommended?: boolean;
  // When true, the server blocks data endpoints until this user enrolls in MFA.
  mfa_enrollment_required?: boolean;
  email_verified?: boolean;
  // When true, the server blocks data endpoints until the email is verified.
  email_verification_required?: boolean;
  // When true, this user has not accepted the current agreement bundle (or has
  // accepted an older version) and the web app shows a blocking consent screen.
  legal_acceptance_required?: boolean;
  // Version of the agreement bundle currently published.
  agreement_version?: string;
  // Unread notices under the header's bell (0 for platform admins).
  notifications_unread?: number;
  subscription?: {
    code: string;
    name: string;
    monthly_price: number;
    max_users: number | null;
    max_branches: number | null;
    status: string;
    expires_at: string | null;
  } | null;
}

export interface Company {
  id: string;
  name: string;
  tin?: string;
  nfa_license_no?: string;
  da_registration_no?: string;
  phone?: string;
  email?: string;
  currency: string;
  timezone: string;
  is_multi_branch: boolean;
}

export interface Branch {
  id: string;
  company_id: string;
  name: string;
  address?: string;
  is_main_branch: boolean;
  is_active: boolean;
}

export interface RiceVariety {
  id: string;
  code: string;
  name: string;
  category?: "inbred" | "hybrid" | "local";
  typical_recovery_pct?: number;
  is_active: boolean;
}

export interface QualityGrade {
  id: string;
  code: string;
  name: string;
  min_moisture_pct?: number;
  max_moisture_pct?: number;
}

export interface Supplier {
  id: string;
  supplier_type?: "farmer" | "trader" | "cooperative";
  name: string;
  contact_person?: string;
  phone?: string;
  address?: string;
  municipality?: string;
  province?: string;
  farmer_id?: string;
  is_active: boolean;
}

export interface Customer {
  id: string;
  customer_type?: "wholesaler" | "retailer" | "walk_in";
  name: string;
  contact_person?: string;
  phone?: string;
  address?: string;
  tin?: string;
  credit_limit: number;
  payment_terms_days: number;
  is_active: boolean;
}

export interface PalayPurchaseItem {
  id: string;
  variety_id?: string;
  grade_id?: string;
  gross_weight_kg: number;
  tare_weight_kg: number;
  net_weight_kg: number;
  cavan_count?: number;
  moisture_content_pct?: number;
  price_per_cavan: number;
  total_amount: number;
}

export interface PalayPurchase {
  id: string;
  reference_no: string;
  supplier_id: string;
  supplier?: Supplier;
  purchase_date: string;
  delivery_type?: string;
  status: "draft" | "received" | "completed" | "cancelled";
  remarks?: string;
  items: PalayPurchaseItem[];
  created_at: string;
}

export interface MillingBatch {
  id: string;
  batch_no: string;
  equipment_id?: string;
  operator_id?: string;
  start_datetime: string;
  end_datetime?: string;
  status: "in_progress" | "completed" | "cancelled";
  inputs: MillingBatchInput[];
  outputs: MillingBatchOutput[];
}

export interface MillingBatchInput {
  id: string;
  variety_id?: string;
  grade_id?: string;
  input_weight_kg: number;
  moisture_content_pct?: number;
}

export interface MillingBatchOutput {
  id: string;
  output_type: "milled_rice" | "ipa" | "darak" | "binlid";
  variety_id?: string;
  output_weight_kg: number;
  broken_rice_pct?: number;
  milling_recovery_pct?: number;
}

export interface InventorySummary {
  palay_total_kg: number;
  milled_rice_total_kg: number;
  byproducts: { ipa?: number; darak?: number; binlid?: number };
}

export interface SalesOrder {
  id: string;
  order_no: string;
  customer_id: string;
  customer?: Customer;
  order_date: string;
  delivery_date?: string;
  status: "draft" | "confirmed" | "delivered" | "invoiced" | "paid";
  discount_pct: number;
  total_amount: number;
  items: SalesOrderItem[];
}

export interface SalesOrderItem {
  id: string;
  item_type: "milled_rice" | "byproduct";
  variety_id?: string;
  grade_name?: string;
  byproduct_type?: string;
  quantity_kg: number;
  unit_price_per_kg: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  invoice_no: string;
  order_id: string;
  customer_id: string;
  invoice_date: string;
  due_date?: string;
  total_amount: number;
  paid_amount: number;
  status: "unpaid" | "partial" | "paid" | "overdue";
}

export interface Expense {
  id: string;
  category_id: string;
  batch_id?: string;
  expense_date: string;
  amount: number;
  description?: string;
  reference_no?: string;
}

export interface PnlReport {
  period_start: string;
  period_end: string;
  revenue: number;
  cost_of_goods: number;
  gross_profit: number;
  operating_expenses: number;
  net_profit: number;
  gross_margin_pct: number;
}

export interface SyncRecord {
  table_name: string;
  record_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  payload: Record<string, unknown>;
  updated_at: string;
}

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  monthly_price: number;
  max_users: number | null;
  max_branches: number | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
}

export type UpgradeRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type UpgradeRequestType = "upgrade" | "change";

export interface UpgradeRequest {
  id: string;
  company_id: string;
  company_name?: string | null;
  requested_plan_id: string;
  requested_plan_code: string | null;
  requested_plan_name: string | null;
  current_plan_id: string | null;
  current_plan_code: string | null;
  current_plan_name: string | null;
  requested_by?: string | null;
  request_type?: UpgradeRequestType | null;
  status: UpgradeRequestStatus;
  note: string | null;
  admin_note: string | null;
  created_at: string | null;
  resolved_at: string | null;
}
