import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";

export function initDatabase(): Database.Database {
  const dbPath = path.join(app.getPath("userData"), "rice-mill-local.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  createSchema(db);
  return db;
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
      password_hash TEXT NOT NULL,
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
      price_per_cavan REAL NOT NULL
    );

    -- Palay inventory
    CREATE TABLE IF NOT EXISTS palay_inventory (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      variety_id TEXT,
      grade_id TEXT,
      quantity_kg REAL DEFAULT 0,
      updated_at TEXT
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
      moisture_content_pct REAL
    );

    -- Milling batch outputs
    CREATE TABLE IF NOT EXISTS milling_batch_outputs (
      id TEXT PRIMARY KEY,
      batch_id TEXT REFERENCES milling_batches(id),
      output_type TEXT NOT NULL,
      variety_id TEXT,
      output_weight_kg REAL NOT NULL,
      broken_rice_pct REAL,
      milling_recovery_pct REAL
    );

    -- Milled rice inventory
    CREATE TABLE IF NOT EXISTS milled_rice_inventory (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      variety_id TEXT,
      grade_name TEXT,
      quantity_kg REAL DEFAULT 0,
      updated_at TEXT
    );

    -- Byproduct inventory
    CREATE TABLE IF NOT EXISTS byproduct_inventory (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      branch_id TEXT,
      byproduct_type TEXT NOT NULL,
      quantity_kg REAL DEFAULT 0,
      updated_at TEXT
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
      unit_price_per_kg REAL NOT NULL
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
      [1, "owner"], [2, "admin"], [3, "mill_operator"],
      [4, "accountant"], [5, "cashier"], [6, "encoder"],
    ].forEach(([id, name]) => insertRole.run(id, name));
  }
}
