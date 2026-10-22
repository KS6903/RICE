import path from "path";
import fs from "fs";
import crypto from "crypto";
import { app } from "electron";
import { SyncIdentity, SYNC_TABLES } from "../sync/contract";
import { createQuarantineTable } from "../sync/quarantine";
import { Db, openDatabase, pragma } from "./db";

/**
 * Owns exactly one identity-partitioned SQLite handle at a time. The renderer
 * cannot choose the partition: activation only receives an identity obtained
 * from a server-validated access token in main/index.ts.
 */
export class TenantDatabaseManager {
  private db: Db | null = null;
  private identity: SyncIdentity | null = null;

  activate(identity: SyncIdentity): Db {
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
    assertSafeDatabaseFile(dbPath);
    migrateLegacyDatabase(identity, dbPath, partition);
    assertSafeDatabaseFile(dbPath);
    const db = openDatabase(dbPath);

    pragma(db, "journal_mode = WAL");
    pragma(db, "foreign_keys = ON");
    pragma(db, "secure_delete = ON");
    pragma(db, "trusted_schema = OFF");
    pragma(db, "busy_timeout = 5000");

    createSchema(db);
    ensureSyncMarkers(db);
    ensureMillingClient(db);
    createQuarantineTable(db);
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

  getDatabase(): Db | null {
    return this.db;
  }

  requireDatabase(): Db {
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

function assertSafeDatabaseFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Refusing unsafe desktop database path");
  }
}

/**
 * One-time, identity-checked migration from the pre-partition desktop database.
 * The original is retained as a named backup until the operator completes the
 * retention checklist in SECURITY.md.
 */
function migrateLegacyDatabase(
  identity: SyncIdentity,
  targetPath: string,
  partition: string,
): void {
  if (fs.existsSync(targetPath)) return;
  const userData = app.getPath("userData");
  const legacyPath = path.join(userData, "rice-mill-local.db");
  const backupPath = path.join(userData, `rice-mill-legacy-${partition}.bak`);
  if (!fs.existsSync(legacyPath)) return;
  try {
    if (fs.existsSync(backupPath)) throw new Error("legacy backup already exists");
    const stat = fs.lstatSync(legacyPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe legacy file");
    const legacy = openDatabase(legacyPath);
    try {
      const tables = legacy
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((row) => row.name));
      if (!names.has("companies") || !names.has("users"))
        throw new Error("missing identity tables");
      const company = legacy
        .prepare("SELECT id FROM companies WHERE id = ? LIMIT 1")
        .get(identity.companyId);
      const foreignCompany = legacy
        .prepare("SELECT id FROM companies WHERE id <> ? LIMIT 1")
        .get(identity.companyId);
      const user = legacy
        .prepare("SELECT id FROM users WHERE id = ? AND company_id = ? LIMIT 1")
        .get(identity.userId, identity.companyId);
      if (!company || foreignCompany || !user) throw new Error("identity mismatch");
      pragma(legacy, "wal_checkpoint(TRUNCATE)");
    } finally {
      legacy.close();
    }

    const temporary = `${targetPath}.migrating`;
    fs.copyFileSync(legacyPath, temporary, fs.constants.COPYFILE_EXCL);
    try {
      const candidate = openDatabase(temporary, { readOnly: true });
      try {
        const integrity = pragma(candidate, "quick_check");
        if (integrity !== "ok") throw new Error("integrity check failed");
      } finally {
        candidate.close();
      }
      fs.renameSync(temporary, targetPath);
      fs.renameSync(legacyPath, backupPath);
      // A successful TRUNCATE checkpoint makes these journal sidecars
      // disposable; do not leave filenames that reveal the retired database.
      fs.rmSync(`${legacyPath}-wal`, { force: true });
      fs.rmSync(`${legacyPath}-shm`, { force: true });
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  } catch {
    // Never guess which tenant owns legacy data and never include user paths or
    // record identifiers in logs. A reviewed manual export remains possible.
    console.error("[database] legacy data was not migrated because identity validation failed");
  }
}

function ensureSyncMarkers(db: Db): void {
  for (const table of SYNC_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "_synced")) {
      // `table` is a compile-time member of SYNC_TABLES, never external input.
      db.exec(`ALTER TABLE ${table} ADD COLUMN _synced INTEGER NOT NULL DEFAULT 0`);
    }
  }
}

// Databases made before batches recorded a client lack these columns.
const MILLING_CLIENT_COLUMNS = ["customer_id", "client_arrangement", "client_notes"] as const;

function ensureMillingClient(db: Db): void {
  const columns = db.prepare("PRAGMA table_info(milling_batches)").all() as Array<{ name: string }>;
  for (const name of MILLING_CLIENT_COLUMNS) {
    if (!columns.some((column) => column.name === name)) {
      // `name` is a compile-time member of MILLING_CLIENT_COLUMNS, never external input.
      db.exec(`ALTER TABLE milling_batches ADD COLUMN ${name} TEXT`);
    }
  }
}

function removeLegacyPasswordHash(db: Db): void {
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "password_hash")) {
    db.exec("ALTER TABLE users DROP COLUMN password_hash");
  }
}

function createSchema(db: Db) {
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
      customer_id TEXT,
      client_arrangement TEXT,
      client_notes TEXT,
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
