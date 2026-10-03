/**
 * Closed sync protocol shared by the desktop push and replay paths.
 *
 * Every identifier later interpolated into a SQLite statement originates from
 * these constants, never from an HTTP response or renderer argument. Keep this
 * contract in lockstep with backend/app/schemas/sync.py and sync_service.py.
 */

export const SYNC_TABLES = [
  "palay_purchases",
  "palay_purchase_items",
  "palay_inventory",
  "milling_batches",
  "milling_batch_inputs",
  "milling_batch_outputs",
  "milled_rice_inventory",
  "byproduct_inventory",
  "sales_orders",
  "sales_order_items",
  "invoices",
  "payments",
  "expenses",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];
export type SyncOperation = "INSERT" | "UPDATE" | "DELETE";
export type SyncScalar = string | number | boolean | null;

export interface SyncIdentity {
  userId: string;
  companyId: string;
  schema: string;
  role: string;
}

export interface SyncRecord {
  table_name: SyncTable;
  record_id: string;
  operation: SyncOperation;
  payload: Record<string, SyncScalar>;
  synced_at?: string;
  updated_at?: string;
}

/** A pulled record this device refused. Never its payload: it may be malformed,
 *  or another tenant's, and neither belongs in the local database. */
export interface PullRejection {
  table: string;
  recordId: string;
  reason: string;
}

export interface SyncPullResponse {
  records: SyncRecord[];
  /** Set aside, so one bad record never holds back the rest of the page. */
  rejected: PullRejection[];
  server_time: string;
  has_more: boolean;
}

const columns = <T extends readonly string[]>(...values: T): T => values;

export const TABLE_COLUMNS: Record<SyncTable, readonly string[]> = {
  palay_purchases: columns(
    "id",
    "company_id",
    "branch_id",
    "reference_no",
    "supplier_id",
    "purchase_date",
    "delivery_type",
    "status",
    "remarks",
    "created_by",
    "created_at",
    "updated_at",
  ),
  palay_purchase_items: columns(
    "id",
    "purchase_id",
    "variety_id",
    "grade_id",
    "gross_weight_kg",
    "tare_weight_kg",
    "cavan_count",
    "moisture_content_pct",
    "price_per_cavan",
  ),
  palay_inventory: columns(
    "id",
    "company_id",
    "branch_id",
    "variety_id",
    "grade_id",
    "quantity_kg",
    "updated_at",
  ),
  milling_batches: columns(
    "id",
    "company_id",
    "branch_id",
    "batch_no",
    "equipment_id",
    "operator_id",
    "start_datetime",
    "end_datetime",
    "status",
    "remarks",
    "created_by",
    "created_at",
    "updated_at",
  ),
  milling_batch_inputs: columns(
    "id",
    "batch_id",
    "variety_id",
    "grade_id",
    "input_weight_kg",
    "moisture_content_pct",
  ),
  milling_batch_outputs: columns(
    "id",
    "batch_id",
    "output_type",
    "variety_id",
    "output_weight_kg",
    "broken_rice_pct",
    "milling_recovery_pct",
  ),
  milled_rice_inventory: columns(
    "id",
    "company_id",
    "branch_id",
    "variety_id",
    "grade_name",
    "quantity_kg",
    "updated_at",
  ),
  byproduct_inventory: columns(
    "id",
    "company_id",
    "branch_id",
    "byproduct_type",
    "quantity_kg",
    "updated_at",
  ),
  sales_orders: columns(
    "id",
    "company_id",
    "branch_id",
    "order_no",
    "customer_id",
    "order_date",
    "delivery_date",
    "status",
    "discount_pct",
    "discount_amount",
    "subtotal",
    "total_amount",
    "remarks",
    "created_by",
    "created_at",
    "updated_at",
  ),
  sales_order_items: columns(
    "id",
    "order_id",
    "item_type",
    "variety_id",
    "grade_name",
    "byproduct_type",
    "quantity_kg",
    "unit_price_per_kg",
  ),
  invoices: columns(
    "id",
    "company_id",
    "branch_id",
    "invoice_no",
    "order_id",
    "customer_id",
    "invoice_date",
    "due_date",
    "total_amount",
    "paid_amount",
    "status",
    "created_by",
    "created_at",
    "updated_at",
  ),
  payments: columns(
    "id",
    "invoice_id",
    "payment_date",
    "amount",
    "method",
    "reference_no",
    "received_by",
    "notes",
    "created_at",
  ),
  expenses: columns(
    "id",
    "company_id",
    "branch_id",
    "category_id",
    "batch_id",
    "expense_date",
    "amount",
    "description",
    "reference_no",
    "approved_by",
    "created_by",
    "created_at",
    "updated_at",
  ),
};

const REQUIRED_INSERT_COLUMNS: Record<SyncTable, readonly string[]> = {
  palay_purchases: columns("reference_no", "purchase_date"),
  palay_purchase_items: columns("purchase_id", "gross_weight_kg", "price_per_cavan"),
  palay_inventory: columns(),
  milling_batches: columns("batch_no", "start_datetime"),
  milling_batch_inputs: columns("batch_id", "input_weight_kg"),
  milling_batch_outputs: columns("batch_id", "output_type", "output_weight_kg"),
  milled_rice_inventory: columns(),
  byproduct_inventory: columns("byproduct_type"),
  sales_orders: columns("order_no", "order_date"),
  sales_order_items: columns("order_id", "item_type", "quantity_kg", "unit_price_per_kg"),
  invoices: columns("invoice_no", "invoice_date", "total_amount"),
  payments: columns("payment_date", "amount", "method"),
  expenses: columns("expense_date", "amount"),
};

const COMPANY_TABLES = new Set<SyncTable>([
  "palay_purchases",
  "palay_inventory",
  "milling_batches",
  "milled_rice_inventory",
  "byproduct_inventory",
  "sales_orders",
  "invoices",
  "expenses",
]);
const TABLE_SET = new Set<string>(SYNC_TABLES);
const OPERATION_SET = new Set<string>(["INSERT", "UPDATE", "DELETE"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AWARE_DATETIME_RE = /(Z|[+-]\d{2}:\d{2})$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is SyncScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function assertAwareDateTime(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !AWARE_DATETIME_RE.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

export function isSyncTable(value: unknown): value is SyncTable {
  return typeof value === "string" && TABLE_SET.has(value);
}

export function assertValidRecord(input: unknown, identity: SyncIdentity): SyncRecord {
  if (!isObject(input) || !isSyncTable(input.table_name)) throw new Error("Invalid sync table");
  if (typeof input.record_id !== "string" || !UUID_RE.test(input.record_id))
    throw new Error("Invalid record id");
  if (typeof input.operation !== "string" || !OPERATION_SET.has(input.operation))
    throw new Error("Invalid sync operation");
  if (!isObject(input.payload)) throw new Error("Invalid sync payload");

  const table = input.table_name;
  const allowed = new Set(TABLE_COLUMNS[table]);
  const payloadEntries = Object.entries(input.payload);
  if (payloadEntries.length > 48) throw new Error("Sync payload has too many fields");
  for (const [key, value] of payloadEntries) {
    if (!allowed.has(key)) throw new Error(`Unsupported sync field for ${table}`);
    if (!isScalar(value) || (typeof value === "string" && value.length > 8_000)) {
      throw new Error(`Invalid sync value for ${table}`);
    }
  }

  const payload = Object.fromEntries(payloadEntries) as Record<string, SyncScalar>;
  if (input.operation === "DELETE") {
    if (payloadEntries.length !== 0) throw new Error("DELETE record contains a payload");
  } else {
    if (payload.id !== input.record_id) throw new Error("Sync payload id mismatch");
    if (input.operation === "INSERT") {
      for (const key of REQUIRED_INSERT_COLUMNS[table]) {
        if (payload[key] === null || payload[key] === undefined)
          throw new Error(`Missing required field for ${table}`);
      }
    }
    if (COMPANY_TABLES.has(table) && payload.company_id !== identity.companyId) {
      throw new Error("Cross-tenant sync record rejected");
    }
  }

  if (input.synced_at !== undefined) assertAwareDateTime(input.synced_at, "synced_at");
  if (input.updated_at !== undefined) assertAwareDateTime(input.updated_at, "updated_at");
  return {
    table_name: table,
    record_id: input.record_id,
    operation: input.operation as SyncOperation,
    payload,
    ...(typeof input.synced_at === "string" ? { synced_at: input.synced_at } : {}),
    ...(typeof input.updated_at === "string" ? { updated_at: input.updated_at } : {}),
  };
}

export function parsePullResponse(input: unknown, identity: SyncIdentity): SyncPullResponse {
  if (!isObject(input) || !Array.isArray(input.records) || input.records.length > 500) {
    throw new Error("Invalid sync pull response");
  }
  assertAwareDateTime(input.server_time, "server_time");
  if (typeof input.has_more !== "boolean") throw new Error("Invalid sync pagination flag");
  // The page itself must be sound (above); a record in it that isn't is set
  // aside, where it used to fail the page, and with it every later sync.
  const records: SyncRecord[] = [];
  const rejected: PullRejection[] = [];
  for (const record of input.records) {
    try {
      records.push(assertValidRecord(record, identity));
    } catch (error) {
      rejected.push({
        table: isObject(record) && isSyncTable(record.table_name) ? record.table_name : "unknown",
        recordId:
          isObject(record) && typeof record.record_id === "string" && UUID_RE.test(record.record_id)
            ? record.record_id
            : "unknown",
        reason: error instanceof Error ? error.message : "Invalid sync record",
      });
    }
  }
  return { records, rejected, server_time: input.server_time, has_more: input.has_more };
}

/** Copy a known local SQLite row into the wire contract without local metadata. */
export function payloadFromLocalRow(
  table: SyncTable,
  row: Record<string, unknown>,
): Record<string, SyncScalar> {
  const payload: Record<string, SyncScalar> = {};
  for (const key of TABLE_COLUMNS[table]) {
    const value = row[key];
    if (value !== undefined) {
      if (!isScalar(value)) throw new Error(`Invalid local value for ${table}`);
      payload[key] = value;
    }
  }
  return payload;
}
