import { ipcMain } from "electron";
import Database from "better-sqlite3";

export function registerIpcHandlers(db: Database.Database) {

  // SECURITY: the generic "db:query" handler (which executed an arbitrary SQL
  // string sent from the renderer) was removed. Exposing raw SQL to the renderer
  // turns any XSS into full local-DB compromise. Every renderer DB need must go
  // through a typed, parameterized handler below — not a SQL pass-through.

  // Check if setup is complete (company exists)
  ipcMain.handle("db:isSetup", () => {
    const row = db.prepare("SELECT id FROM companies LIMIT 1").get();
    return !!row;
  });

  // Palay purchases — local CRUD
  ipcMain.handle("palay:getPurchases", () => {
    return db.prepare(`
      SELECT pp.*, s.name as supplier_name
      FROM palay_purchases pp
      LEFT JOIN suppliers s ON s.id = pp.supplier_id
      ORDER BY pp.purchase_date DESC
      LIMIT 100
    `).all();
  });

  ipcMain.handle("milling:getBatches", () => {
    return db.prepare(`
      SELECT mb.*
      FROM milling_batches mb
      ORDER BY mb.start_datetime DESC
      LIMIT 100
    `).all();
  });

  ipcMain.handle("inventory:getSummary", () => {
    const palayKg = db.prepare("SELECT SUM(quantity_kg) as total FROM palay_inventory").get() as { total: number };
    const milledKg = db.prepare("SELECT SUM(quantity_kg) as total FROM milled_rice_inventory").get() as { total: number };
    const byproducts = db.prepare("SELECT byproduct_type, SUM(quantity_kg) as kg FROM byproduct_inventory GROUP BY byproduct_type").all();
    return {
      palay_total_kg: palayKg?.total || 0,
      milled_rice_total_kg: milledKg?.total || 0,
      byproducts: Object.fromEntries((byproducts as any[]).map(b => [b.byproduct_type, b.kg])),
    };
  });

  // Note: "sync:setToken" is registered at app level (main/index.ts) where the
  // SyncEngine lives — it also persists the token via safeStorage there.
}
