import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { app } from "electron";
import { SyncIdentity, SYNC_TABLES } from "../sync/contract";

/**
 * Owns exactly one identity-partitioned SQLite handle at a time. The renderer
 * cannot choose the partition: activation only receives an identity obtained
 * from a server-validated access token in main/index.ts.
 */
export class TenantDatabaseManager {
  private db: Database.Database | null = null;
  private identity: SyncIdentity | null = null;

  activate(identity: SyncIdentity): Database.Database {
    if (
      this.db &&
      this.identity?.companyId === identity.companyId &&
      this.identity.userId === identity.userId
    ) {
      this.identity = { ...identity };
      return this.db;
    }
    this.clear();

    const partition = crypto
      .createHash("sha256")
      .update(`${identity.companyId}:${identity.userId}`, "utf8")
      .digest("hex")
      .slice(0, 32);
    const dbPath = path.join(app.getPath("userData"), `rice-mill-${partition}.db`);
    const db = new Database(dbPath);

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("secure_delete = ON");
    db.pragma("trusted_schema = OFF");
    db.pragma("busy_timeout = 5000");

    createSchema(db);
    ensureSyncMarkers(db);
    removeLegacyPasswordHash(db);
    try {
      // Best effort on POSIX. Windows privacy is inherited from Electron's
      // per-user app-data ACL; see packages/desktop/SECURITY.md.
      if (process.platform !== "win32") fs.chmodSync(dbPath, 0o600);
    } catch {
      // Failure to tighten an already user-owned file is non-fatal; never log a
      // path containing local account data.
    }

    this.db = db;
    this.identity = { ...identity };
    return db;
  }

  getDatabase(): Database.Database | null {
    return this.db;
  }

  requireDatabase(): Database.Database {
    if (!this.db || !this.identity) throw new Error("No authenticated desktop data session");
    return this.db;
  }

  getIdentity(): SyncIdentity | null {
    return this.identity ? { ...this.identity } : null;
  }

  clear(): void {
    if (this.db) this.db.close();
    this.db = null;
    this.identity = null;
  }
}

export function initDatabase(): TenantDatabaseManager {
  return new TenantDatabaseManager();
}

function ensureSyncMarkers(db: Database.Database): void {
  for (const table of SYNC_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "_synced")) {
      // `table` is a compile-time member of SYNC_TABLES, never external input.
      db.exec(`ALTER TABLE ${table} ADD COLUMN _synced INTEGER NOT NULL DEFAULT 0`);
    }
  }
}

function removeLegacyPasswordHash(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "password_hash")) {
    db.exec("ALTER TABLE users DROP COLUMN password_hash");
  }
}

function createSchema(db: Database.Database) {
  db.exec(`
    -- Sync metadata
    CREATE TABLE IF NOT EXISTS _local_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Companies
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      tin TEXT,
      nfa_license_no TEXT,
      da_registration_no TEXT,
      phone TEXT,
      email TEXT,
      currency TEXT DEFAULT 'PHP',
      timezone TEXT DEFAULT 'Asia/Manila',
      is_multi_branch INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    -- Branches
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id),
      name TEXT NOT NULL,
      address TEXT,
      is_main_branch INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT
    );

    -- Roles
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      full_name TEXT NOT NULL,
      role_id INTEGER,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- Rice varieties
    CREATE TABLE IF NOT EXISTS rice_varieties (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      typical_recovery_pct REAL,
      is_active INTEGER DEFAULT 1
    );

    -- Quality grades
    CREATE TABLE IF NOT EXISTS quality_grades (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      min_moisture_pct REAL,
      max_moisture_pct REAL,
      description TEXT
    );

    -- Suppliers
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      supplier_type TEXT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      address TEXT,
      municipality TEXT,
      province TEXT,
      farmer_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    -- Customers
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      customer_type TEXT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      address TEXT,
      tin TEXT,
      credit_limit REAL DEFAULT 0,
      payment_terms_days INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    -- Palay purchases
    CREATE TABLE IF NOT EXISTS palay_purchases (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      reference_no TEXT UNIQUE NOT NULL,
      supplier_id TEXT,
      purchase_date TEXT NOT NULL,
      delivery_type TEXT,
      status TEXT DEFAULT 'draft',
      remarks TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Palay purchase items
    CREATE TABLE IF NOT EXISTS palay_purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT REFERENCES palay_purchases(id),
      variety_id TEXT,
      grade_id TEXT,
      gross_weight_kg REAL NOT NULL,
      tare_weight_kg REAL DEFAULT 0,
      cavan_count REAL,
      moisture_content_pct REAL,
      price_per_cavan REAL NOT NULL,
      _synced INTEGER DEFAULT 0
    );

    -- Palay inventory
    CREATE TABLE IF NOT EXISTS palay_inventory (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      variety_id TEXT,
      grade_id TEXT,
      quantity_kg REAL DEFAULT 0,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Milling batches
    CREATE TABLE IF NOT EXISTS milling_batches (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      batch_no TEXT UNIQUE NOT NULL,
      equipment_id TEXT,
      operator_id TEXT,
      start_datetime TEXT NOT NULL,
      end_datetime TEXT,
      status TEXT DEFAULT 'in_progress',
      remarks TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Milling batch inputs
    CREATE TABLE IF NOT EXISTS milling_batch_inputs (
      id TEXT PRIMARY KEY,
      batch_id TEXT REFERENCES milling_batches(id),
      variety_id TEXT,
      grade_id TEXT,
      input_weight_kg REAL NOT NULL,
      moisture_content_pct REAL,
      _synced INTEGER DEFAULT 0
    );

    -- Milling batch outputs
    CREATE TABLE IF NOT EXISTS milling_batch_outputs (
      id TEXT PRIMARY KEY,
      batch_id TEXT REFERENCES milling_batches(id),
      output_type TEXT NOT NULL,
      variety_id TEXT,
      output_weight_kg REAL NOT NULL,
      broken_rice_pct REAL,
      milling_recovery_pct REAL,
      _synced INTEGER DEFAULT 0
    );

    -- Milled rice inventory
    CREATE TABLE IF NOT EXISTS milled_rice_inventory (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      variety_id TEXT,
      grade_name TEXT,
      quantity_kg REAL DEFAULT 0,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Byproduct inventory
    CREATE TABLE IF NOT EXISTS byproduct_inventory (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      byproduct_type TEXT NOT NULL,
      quantity_kg REAL DEFAULT 0,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Sales orders
    CREATE TABLE IF NOT EXISTS sales_orders (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      order_no TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      order_date TEXT NOT NULL,
      delivery_date TEXT,
      status TEXT DEFAULT 'draft',
      discount_pct REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      subtotal REAL,
      total_amount REAL,
      remarks TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Sales order items
    CREATE TABLE IF NOT EXISTS sales_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT REFERENCES sales_orders(id),
      item_type TEXT NOT NULL,
      variety_id TEXT,
      grade_name TEXT,
      byproduct_type TEXT,
      quantity_kg REAL NOT NULL,
      unit_price_per_kg REAL NOT NULL,
      _synced INTEGER DEFAULT 0
    );

    -- Invoices
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      invoice_no TEXT UNIQUE NOT NULL,
      order_id TEXT,
      customer_id TEXT,
      invoice_date TEXT NOT NULL,
      due_date TEXT,
      total_amount REAL NOT NULL,
      paid_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'unpaid',
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Payments
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT REFERENCES invoices(id),
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      reference_no TEXT,
      received_by TEXT,
      notes TEXT,
      created_at TEXT,
      _synced INTEGER DEFAULT 0
    );

    -- Expense categories
    CREATE TABLE IF NOT EXISTS expense_categories (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      name TEXT NOT NULL,
      is_production_cost INTEGER DEFAULT 1
    );

    -- Expenses
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      category_id TEXT,
      batch_id TEXT,
      expense_date TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      reference_no TEXT,
      approved_by TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT,
      _synced INTEGER DEFAULT 0
    );
  `);

  // Seed default roles if empty
  const roleCount = db.prepare("SELECT COUNT(*) as c FROM roles").get() as { c: number };
  if (roleCount.c === 0) {
    const insertRole = db.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)");
    [
      [1, "owner"],
      [2, "admin"],
      [3, "mill_operator"],
      [4, "accountant"],
      [5, "cashier"],
      [6, "encoder"],
    ].forEach(([id, name]) => insertRole.run(id, name));
  }
}
